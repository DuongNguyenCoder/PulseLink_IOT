import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma/client.js";

type Platform = "ANDROID" | "IOS" | "WEB";

interface Arguments {
  confirmProduction: boolean;
  storeId?: string;
  expectedStoreSlug: string;
  expectedStoreName?: string;
  expectedDatabaseName: string;
  staffId?: string;
  createStaff: boolean;
  reuseExistingStaff: boolean;
  staffName?: string;
  staffEmail?: string;
  platform: Platform;
}

function usage(): never {
  throw new Error(
    "Usage: --confirm-production --expected-database-name <name> " +
      "--store-id <id> --expected-store-slug <slug> --create-staff " +
      "--staff-name <name> --staff-email <email> [--expected-store-name <name>] " +
      "[--reuse-existing-staff] [--platform ANDROID|IOS|WEB]",
  );
}

function parseArguments(argv: string[]): Arguments {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === undefined) continue;
    if (value.startsWith("--") && argv[index + 1]?.startsWith("--") !== true) {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        values.set(value, next);
        index += 1;
        continue;
      }
    }
    if (value.startsWith("--")) flags.add(value);
    else usage();
  }

  const platform = values.get("--platform") ?? "ANDROID";
  if (platform !== "ANDROID" && platform !== "IOS" && platform !== "WEB") {
    throw new Error("--platform must be ANDROID, IOS or WEB");
  }

  const result: Arguments = {
    confirmProduction: flags.has("--confirm-production"),
    storeId: values.get("--store-id"),
    expectedStoreSlug: values.get("--expected-store-slug") ?? "",
    expectedStoreName: values.get("--expected-store-name"),
    expectedDatabaseName: values.get("--expected-database-name") ?? "",
    staffId: values.get("--staff-id"),
    createStaff: flags.has("--create-staff"),
    reuseExistingStaff: flags.has("--reuse-existing-staff"),
    staffName: values.get("--staff-name"),
    staffEmail: values.get("--staff-email")?.toLowerCase(),
    platform,
  };

  if (!result.confirmProduction) throw new Error("--confirm-production is required");
  if (result.createStaff === (result.staffId !== undefined)) usage();
  if (!result.storeId || !result.expectedStoreSlug || !result.expectedDatabaseName) {
    throw new Error("--store-id, --expected-store-slug and --expected-database-name are required");
  }
  if (!result.createStaff && !result.staffId) usage();
  if (result.reuseExistingStaff && !result.createStaff) {
    throw new Error("--reuse-existing-staff is only valid with --create-staff");
  }
  if (result.createStaff && (!result.staffName || !result.staffEmail)) {
    throw new Error("--create-staff requires --staff-name and --staff-email");
  }

  return result;
}

function databaseUrl(expectedDatabaseName: string): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must use a PostgreSQL protocol");
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!databaseName) throw new Error("DATABASE_URL must include a database name");
  if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error("Refusing to run the production recipient script against localhost");
  }
  if (/(^|[-_])(test|dev|development|local|staging)([-_]|$)/i.test(databaseName)) {
    throw new Error("Refusing to run the production recipient script against a test/dev/staging database");
  }
  if (databaseName !== expectedDatabaseName) {
    throw new Error("DATABASE_URL database name does not match --expected-database-name");
  }
  return value;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const args = parseArguments(process.argv.slice(2));
const connectionString = databaseUrl(args.expectedDatabaseName);
const fcmToken = requiredEnvironment("PRODUCTION_FCM_TOKEN");
if (fcmToken.length < 20) throw new Error("PRODUCTION_FCM_TOKEN is invalid");
if (fcmToken.length > 2048) throw new Error("PRODUCTION_FCM_TOKEN is invalid");

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString,
    ssl: {
      ca: process.env.DB_SSL_CA,
      rejectUnauthorized: true,
    },
  }),
});

async function main(): Promise<void> {
  const identity = await prisma.$queryRaw<Array<{ database_name: string }>>`SELECT current_database() AS database_name`;
  if (identity[0]?.database_name !== args.expectedDatabaseName) {
    throw new Error("Connected database identity does not match --expected-database-name");
  }

  const result = await prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({
      where: { id: args.storeId! },
      select: { id: true, name: true, slug: true, isActive: true },
    });

    if (store === null) throw new Error("Target Store was not found");
    if (!store.isActive) throw new Error("Target Store is not active");
    if (store.slug !== args.expectedStoreSlug) throw new Error("Target Store slug does not match --expected-store-slug");
    if (args.expectedStoreName !== undefined && store.name !== args.expectedStoreName) {
      throw new Error("Target Store name does not match --expected-store-name");
    }

    const staff = args.createStaff
      ? await (async () => {
          const existing = await tx.staff.findUnique({
            where: { email: args.staffEmail! },
            select: { id: true, storeId: true, isActive: true },
          });
          if (existing !== null) {
            if (!args.reuseExistingStaff) {
              throw new Error("Staff email already exists; use --reuse-existing-staff only after verification");
            }
            if (existing.storeId !== store.id) throw new Error("Staff email belongs to a different Store");
            if (!existing.isActive) throw new Error("Target Staff is not active");
            return existing;
          }
          return tx.staff.create({
            data: {
              name: args.staffName!,
              email: args.staffEmail!,
              storeId: store.id,
              isActive: true,
            },
            select: { id: true, storeId: true, isActive: true },
          });
        })()
      : await tx.staff.findUnique({
          where: { id: args.staffId! },
          select: { id: true, storeId: true, isActive: true },
        });

    if (staff === null) throw new Error("Target Staff was not found");
    if (staff.storeId !== store.id) throw new Error("Target Staff does not belong to the target Store");
    if (!staff.isActive) throw new Error("Target Staff is not active");

    const existingToken = await tx.staffPushToken.findUnique({
      where: { token: fcmToken },
      select: { id: true, staffId: true },
    });
    if (existingToken !== null && existingToken.staffId !== staff.id) {
      throw new Error("FCM token is already bound to a different Staff");
    }

    const pushToken = existingToken === null
      ? await tx.staffPushToken.create({
          data: { token: fcmToken, platform: args.platform, staffId: staff.id, isActive: true, lastSeenAt: new Date() },
          select: { id: true, staffId: true, platform: true, isActive: true },
        })
      : await tx.staffPushToken.update({
          where: { id: existingToken.id },
          data: { platform: args.platform, staffId: staff.id, isActive: true, lastSeenAt: new Date() },
          select: { id: true, staffId: true, platform: true, isActive: true },
        });

    return { storeId: store.id, staffId: staff.id, pushTokenId: pushToken.id, platform: pushToken.platform, isActive: pushToken.isActive };
  });

  process.stdout.write(`${JSON.stringify({ ...result, fcmTokenRegistered: true })}\n`);
}

try {
  await main();
} catch (error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new Error("A unique production record already exists; no partial transaction was committed");
  }
  throw error;
} finally {
  await prisma.$disconnect();
}
