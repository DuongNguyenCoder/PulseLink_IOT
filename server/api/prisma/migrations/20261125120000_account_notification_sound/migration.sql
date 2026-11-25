-- Store the selected built-in notification sound on the Account. The catalog
-- is application-owned; no user-uploaded audio is persisted.
ALTER TABLE "Account"
    ADD COLUMN "notificationSoundId" VARCHAR(80) NOT NULL DEFAULT 'sound_notification_1';
