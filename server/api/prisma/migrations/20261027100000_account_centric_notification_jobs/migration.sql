-- Additive Account/AppInstallation notification destination support.
ALTER TYPE "NotificationStatus" ADD VALUE 'CANCELLED';

ALTER TABLE "DeviceNotification"
    ADD COLUMN "appInstallationId" TEXT,
    ALTER COLUMN "pushTokenId" DROP NOT NULL;

ALTER TABLE "DeviceNotification"
    ADD CONSTRAINT "DeviceNotification_appInstallationId_fkey"
    FOREIGN KEY ("appInstallationId") REFERENCES "AppInstallation"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "DeviceNotification_eventId_appInstallationId_key"
    ON "DeviceNotification"("eventId", "appInstallationId");

CREATE INDEX "DeviceNotification_appInstallationId_idx"
    ON "DeviceNotification"("appInstallationId");
