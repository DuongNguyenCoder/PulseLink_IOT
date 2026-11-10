-- Retire the legacy Staff notification schema after the runtime moved to
-- Account -> StoreMembership -> AppInstallation.

ALTER TABLE "DeviceNotification"
    DROP CONSTRAINT "DeviceNotification_pushTokenId_fkey";

DROP INDEX "DeviceNotification_eventId_pushTokenId_key";

ALTER TABLE "DeviceNotification"
    DROP COLUMN "pushTokenId";

DROP INDEX "StaffPushToken_staffId_isActive_idx";
DROP INDEX "StaffPushToken_token_key";

ALTER TABLE "StaffPushToken"
    DROP CONSTRAINT "StaffPushToken_staffId_fkey";

ALTER TABLE "Staff"
    DROP CONSTRAINT "Staff_storeId_fkey";

DROP TABLE "StaffPushToken";
DROP TABLE "Staff";
