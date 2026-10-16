-- Add durable claiming and retry scheduling to the notification outbox.
ALTER TYPE "NotificationStatus" ADD VALUE 'PROCESSING';

ALTER TABLE "DeviceNotification"
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "leaseUntil" TIMESTAMP(3);

DROP INDEX IF EXISTS "DeviceNotification_status_createdAt_idx";
CREATE INDEX "DeviceNotification_status_nextAttemptAt_idx"
  ON "DeviceNotification"("status", "nextAttemptAt");
CREATE INDEX "DeviceNotification_status_leaseUntil_idx"
  ON "DeviceNotification"("status", "leaseUntil");
