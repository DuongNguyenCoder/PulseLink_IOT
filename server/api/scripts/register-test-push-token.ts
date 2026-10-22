import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { assertIntegrationDatabaseEnvironment } from "../src/test-support/integration-db-guard.js";

const testDatabase = assertIntegrationDatabaseEnvironment(process.env);
const staffId = process.env.TEST_STAFF_ID;
const fcmToken = process.env.TEST_FCM_TOKEN;
const platform = process.env.TEST_PUSH_PLATFORM ?? "ANDROID";

if (!staffId) throw new Error("TEST_STAFF_ID is required");
if (!fcmToken || fcmToken.length < 20) throw new Error("TEST_FCM_TOKEN is required");
if (platform !== "ANDROID" && platform !== "IOS" && platform !== "WEB") {
  throw new Error("TEST_PUSH_PLATFORM must be ANDROID, IOS or WEB");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: testDatabase.url }),
});

async function main(): Promise<void> {
  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    select: { id: true, storeId: true, isActive: true },
  });
  if (staff === null || !staff.isActive) throw new Error("TEST_STAFF_ID must identify an active test Staff");

  const existing = await prisma.staffPushToken.findUnique({
    where: { token: fcmToken },
    select: { id: true, staffId: true },
  });
  if (existing !== null && existing.staffId !== staff.id) {
    throw new Error("FCM token is already bound to a different Staff");
  }

  const token = existing === null
    ? await prisma.staffPushToken.create({
        data: { staffId: staff.id, token: fcmToken, platform, isActive: true, lastSeenAt: new Date() },
        select: { id: true, staffId: true, platform: true, isActive: true },
      })
    : await prisma.staffPushToken.update({
        where: { id: existing.id },
        data: { staffId: staff.id, platform, isActive: true, lastSeenAt: new Date() },
        select: { id: true, staffId: true, platform: true, isActive: true },
      });

  process.stdout.write(`${JSON.stringify({ storeId: staff.storeId, pushTokenId: token.id, staffId: token.staffId, platform: token.platform, isActive: token.isActive })}\n`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
