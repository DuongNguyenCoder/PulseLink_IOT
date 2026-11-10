import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { assertIntegrationDatabaseEnvironment } from "../src/test-support/integration-db-guard.js";

const testDatabase = assertIntegrationDatabaseEnvironment(process.env);
const storeId = process.env.TEST_STORE_ID;

if (!storeId) throw new Error("TEST_STORE_ID is required");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: testDatabase.url }),
});

async function main(): Promise<void> {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true, isActive: true } });
  if (store === null || !store.isActive) throw new Error("TEST_STORE_ID must identify an active test Store");

  const suffix = randomBytes(5).toString("hex");
  const account = await prisma.account.create({
    data: {
      emailNormalized: `fcm-test-${suffix}@example.invalid`,
      passwordHash: "integration-test-hash",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });
  await prisma.storeMembership.create({
    data: { accountId: account.id, storeId: store.id, role: "STAFF", status: "ACTIVE" },
  });
  const installation = await prisma.appInstallation.create({
    data: { accountId: account.id, platform: "ANDROID" },
    select: { id: true },
  });

  process.stdout.write(`${JSON.stringify({ storeId: store.id, accountId: account.id, installationId: installation.id })}\n`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
