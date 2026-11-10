import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { loadFcmKeys } from "../src/config/runtime.js";
import { registerInstallation } from "../src/modules/installations/installation.service.js";
import { assertIntegrationDatabaseEnvironment } from "../src/test-support/integration-db-guard.js";

const testDatabase = assertIntegrationDatabaseEnvironment(process.env);
const accountId = process.env.TEST_ACCOUNT_ID;
const installationId = process.env.TEST_INSTALLATION_ID;
const fcmToken = process.env.TEST_FCM_TOKEN;
const platform = process.env.TEST_PUSH_PLATFORM ?? "ANDROID";

if (!accountId) throw new Error("TEST_ACCOUNT_ID is required");
if (!fcmToken || fcmToken.length < 20) throw new Error("TEST_FCM_TOKEN is required");
if (platform !== "ANDROID" && platform !== "IOS" && platform !== "WEB") {
  throw new Error("TEST_PUSH_PLATFORM must be ANDROID, IOS or WEB");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: testDatabase.url }),
});

try {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, status: true },
  });
  if (account === null || account.status !== "ACTIVE") {
    throw new Error("TEST_ACCOUNT_ID must identify an active Account");
  }
  const installation = await registerInstallation(
    prisma as never,
    accountId,
    {
      installationId: installationId ?? `test-installation-${Date.now()}`,
      platform,
      fcmToken,
    },
    loadFcmKeys(),
  );
  process.stdout.write(`${JSON.stringify({ accountId: installation.accountId, installationId: installation.id, platform: installation.platform, status: installation.status })}\n`);
} finally {
  await prisma.$disconnect();
}
