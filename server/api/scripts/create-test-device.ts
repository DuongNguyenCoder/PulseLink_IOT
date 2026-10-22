import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const databaseUrl = process.env.DATABASE_URL;
const deviceToken = process.env.TEST_DEVICE_TOKEN;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

if (!deviceToken || deviceToken.length < 32) {
  throw new Error("TEST_DEVICE_TOKEN is required and must be at least 32 characters");
}

const requiredDeviceToken = deviceToken;

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: databaseUrl,
    ssl: {
      ca: process.env.DB_SSL_CA,
      rejectUnauthorized: true,
    },
  }),
});

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function createSuffix(): string {
  return randomBytes(5).toString("hex");
}

async function main(): Promise<void> {
  const suffix = createSuffix();
  const requestedStoreId = process.env.TEST_STORE_ID;
  const store = requestedStoreId
    ? await prisma.store.findUnique({ where: { id: requestedStoreId } })
    : await prisma.store.create({
        data: {
          name: process.env.TEST_STORE_NAME ?? `Postman Test Store ${suffix}`,
          slug: process.env.TEST_STORE_SLUG ?? `postman-test-${suffix}`,
          timezone: "Asia/Ho_Chi_Minh",
        },
      });

  if (!store) {
    throw new Error("TEST_STORE_ID does not exist");
  }

  const device = await prisma.device.create({
    data: {
      deviceKey: process.env.TEST_DEVICE_KEY ?? `postman-test-device-${suffix}`,
      deviceSecretHash: hashToken(requiredDeviceToken),
      name: process.env.TEST_DEVICE_NAME ?? `Postman Test Device ${suffix}`,
      type: "CALL_BUTTON",
      status: "ONLINE",
      provisioningState: "PROVISIONED",
      enrollmentStatus: "ENROLLED",
      enrolledAt: new Date(),
      storeId: store.id,
    },
  });

  process.stdout.write(
    JSON.stringify(
      {
        storeId: store.id,
        deviceId: device.id,
        deviceKey: device.deviceKey,
        status: device.status,
        provisioningState: device.provisioningState,
        enrollmentStatus: device.enrollmentStatus,
        tokenWasStoredAsSha256: true,
        nextStep: "Set the same TEST_DEVICE_TOKEN as Postman environment variable device_token.",
      },
      null,
      2,
    ) + "\n",
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
