-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('CALL_BUTTON');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('PENDING', 'ONLINE', 'OFFLINE', 'DISABLED');

-- CreateEnum
CREATE TYPE "DeviceEventType" AS ENUM ('BUTTON_PRESSED');

-- CreateEnum
CREATE TYPE "DeviceEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "PushPlatform" AS ENUM ('ANDROID', 'IOS', 'WEB');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "timezone" VARCHAR(60) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "deviceKey" VARCHAR(64) NOT NULL,
    "deviceSecretHash" VARCHAR(255) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "DeviceType" NOT NULL DEFAULT 'CALL_BUTTON',
    "status" "DeviceStatus" NOT NULL DEFAULT 'PENDING',
    "firmwareVersion" VARCHAR(40),
    "lastSeenAt" TIMESTAMP(3),
    "storeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceEvent" (
    "id" TEXT NOT NULL,
    "eventId" UUID NOT NULL,
    "deviceId" TEXT NOT NULL,
    "type" "DeviceEventType" NOT NULL,
    "status" "DeviceEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "firmwareVersion" VARCHAR(40),
    "rssiDbm" INTEGER,
    "payload" JSONB,

    CONSTRAINT "DeviceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(20),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "storeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffPushToken" (
    "id" TEXT NOT NULL,
    "token" VARCHAR(2048) NOT NULL,
    "platform" "PushPlatform" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "staffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffPushToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceNotification" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "pushTokenId" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "fcmMessageId" VARCHAR(255),
    "lastError" VARCHAR(1000),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Store_slug_key" ON "Store"("slug");

-- CreateIndex
CREATE INDEX "Store_isActive_idx" ON "Store"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Device_deviceKey_key" ON "Device"("deviceKey");

-- CreateIndex
CREATE INDEX "Device_storeId_status_idx" ON "Device"("storeId", "status");

-- CreateIndex
CREATE INDEX "Device_lastSeenAt_idx" ON "Device"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceEvent_eventId_key" ON "DeviceEvent"("eventId");

-- CreateIndex
CREATE INDEX "DeviceEvent_deviceId_occurredAt_idx" ON "DeviceEvent"("deviceId", "occurredAt");

-- CreateIndex
CREATE INDEX "DeviceEvent_status_receivedAt_idx" ON "DeviceEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_email_key" ON "Staff"("email");

-- CreateIndex
CREATE INDEX "Staff_storeId_isActive_idx" ON "Staff"("storeId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "StaffPushToken_token_key" ON "StaffPushToken"("token");

-- CreateIndex
CREATE INDEX "StaffPushToken_staffId_isActive_idx" ON "StaffPushToken"("staffId", "isActive");

-- CreateIndex
CREATE INDEX "DeviceNotification_status_createdAt_idx" ON "DeviceNotification"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceNotification_eventId_pushTokenId_key" ON "DeviceNotification"("eventId", "pushTokenId");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceEvent" ADD CONSTRAINT "DeviceEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPushToken" ADD CONSTRAINT "StaffPushToken_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceNotification" ADD CONSTRAINT "DeviceNotification_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DeviceEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceNotification" ADD CONSTRAINT "DeviceNotification_pushTokenId_fkey" FOREIGN KEY ("pushTokenId") REFERENCES "StaffPushToken"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
