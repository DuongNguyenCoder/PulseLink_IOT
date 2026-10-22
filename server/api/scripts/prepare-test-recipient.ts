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
  const staff = await prisma.staff.create({
    data: {
      storeId: store.id,
      name: `FCM Test Recipient ${suffix}`,
      email: `fcm-test-${suffix}@example.invalid`,
      isActive: true,
    },
    select: { id: true, storeId: true, name: true },
  });

  process.stdout.write(`${JSON.stringify({ storeId: staff.storeId, staffId: staff.id, name: staff.name })}\n`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
