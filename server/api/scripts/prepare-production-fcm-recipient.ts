import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { loadFcmKeys } from "../src/config/runtime.js";
import { registerInstallation } from "../src/modules/installations/installation.service.js";

type Platform = "ANDROID" | "IOS" | "WEB";
interface Arguments {
  confirmProduction: boolean;
  storeId: string;
  expectedStoreSlug: string;
  expectedStoreName?: string;
  expectedDatabaseName: string;
  accountId: string;
  installationId?: string;
  platform: Platform;
}

function usage(): never {
  throw new Error("Usage: --confirm-production --expected-database-name <name> --store-id <id> --expected-store-slug <slug> --account-id <id> [--installation-id <id>] [--expected-store-name <name>] [--platform ANDROID|IOS|WEB]");
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
  if (platform !== "ANDROID" && platform !== "IOS" && platform !== "WEB") throw new Error("--platform must be ANDROID, IOS or WEB");
  const result: Arguments = {
    confirmProduction: flags.has("--confirm-production"),
    storeId: values.get("--store-id") ?? "",
    expectedStoreSlug: values.get("--expected-store-slug") ?? "",
    expectedStoreName: values.get("--expected-store-name"),
    expectedDatabaseName: values.get("--expected-database-name") ?? "",
    accountId: values.get("--account-id") ?? "",
    installationId: values.get("--installation-id"),
    platform,
  };
  if (!result.confirmProduction) throw new Error("--confirm-production is required");
  if (!result.storeId || !result.expectedStoreSlug || !result.expectedDatabaseName || !result.accountId) usage();
  return result;
}

function databaseUrl(expectedDatabaseName: string): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required");
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("DATABASE_URL must be a valid PostgreSQL URL"); }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") throw new Error("DATABASE_URL must use a PostgreSQL protocol");
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!databaseName || ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) throw new Error("Refusing to run the production recipient script against a local or unnamed database");
  if (/(^|[-_])(test|dev|development|local|staging)([-_]|$)/i.test(databaseName)) throw new Error("Refusing to run the production recipient script against a test/dev/staging database");
  if (databaseName !== expectedDatabaseName) throw new Error("DATABASE_URL database name does not match --expected-database-name");
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
if (fcmToken.length < 20 || fcmToken.length > 2048) throw new Error("PRODUCTION_FCM_TOKEN is invalid");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString, ssl: { ca: process.env.DB_SSL_CA, rejectUnauthorized: true } }),
});

try {
  const identity = await prisma.$queryRaw<Array<{ database_name: string }>>`SELECT current_database() AS database_name`;
  if (identity[0]?.database_name !== args.expectedDatabaseName) throw new Error("Connected database identity does not match --expected-database-name");
  const store = await prisma.store.findUnique({ where: { id: args.storeId }, select: { id: true, name: true, slug: true, isActive: true } });
  if (store === null || !store.isActive || store.slug !== args.expectedStoreSlug || (args.expectedStoreName !== undefined && store.name !== args.expectedStoreName)) throw new Error("Target Store identity or active state does not match the supplied confirmation values");
  const membership = await prisma.storeMembership.findFirst({ where: { accountId: args.accountId, storeId: store.id, status: "ACTIVE" }, select: { accountId: true } });
  if (membership === null) throw new Error("Account must have an active membership in the target Store");
  const account = await prisma.account.findUnique({ where: { id: args.accountId }, select: { status: true } });
  if (account?.status !== "ACTIVE") throw new Error("Target Account is not active");
  const installation = await registerInstallation(prisma as never, args.accountId, { installationId: args.installationId ?? `production-installation-${Date.now()}`, platform: args.platform, fcmToken }, loadFcmKeys());
  process.stdout.write(`${JSON.stringify({ storeId: store.id, accountId: installation.accountId, installationId: installation.id, platform: installation.platform, status: installation.status, fcmTokenRegistered: true })}\n`);
} finally {
  await prisma.$disconnect();
}
