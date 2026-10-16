-- Additive Device provisioning foundation.
-- J.3 must enforce redemption, attempt counting, credential issuance and
-- AuditEvent atomicity in a transaction. No plaintext bootstrap material is
-- represented by this schema.

CREATE TYPE "DeviceProvisioningState" AS ENUM (
    'UNREGISTERED',
    'READY',
    'PROVISIONED',
    'NEEDS_RECONNECTION',
    'REVOKED'
);

CREATE TYPE "DeviceEnrollmentStatus" AS ENUM (
    'UNENROLLED',
    'ENROLLED',
    'REVOKED'
);

CREATE TYPE "ProvisioningSessionStatus" AS ENUM (
    'ACTIVE',
    'REDEEMED',
    'EXPIRED',
    'LOCKED',
    'REVOKED'
);

ALTER TABLE "Device"
    ADD COLUMN "provisioningState" "DeviceProvisioningState" NOT NULL DEFAULT 'UNREGISTERED',
    ADD COLUMN "enrollmentStatus" "DeviceEnrollmentStatus" NOT NULL DEFAULT 'UNENROLLED',
    ADD COLUMN "enrollmentPublicKey" TEXT,
    ADD COLUMN "enrollmentKeyVersion" INTEGER,
    ADD COLUMN "enrolledAt" TIMESTAMP(3),
    ADD COLUMN "enrollmentRevokedAt" TIMESTAMP(3);

CREATE INDEX "Device_storeId_provisioningState_idx"
    ON "Device"("storeId", "provisioningState");

CREATE INDEX "Device_enrollmentStatus_enrollmentKeyVersion_idx"
    ON "Device"("enrollmentStatus", "enrollmentKeyVersion");

CREATE UNIQUE INDEX "Device_id_storeId_key"
    ON "Device"("id", "storeId");

CREATE TABLE "ProvisioningSession" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "actorAccountId" TEXT NOT NULL,
    "bootstrapVerifier" VARCHAR(128) NOT NULL,
    "challengeHash" VARCHAR(128) NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "status" "ProvisioningSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProvisioningSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProvisioningSession_bootstrapVerifier_key"
    ON "ProvisioningSession"("bootstrapVerifier");

CREATE UNIQUE INDEX "ProvisioningSession_deviceId_actorAccountId_idempotencyKey_key"
    ON "ProvisioningSession"("deviceId", "actorAccountId", "idempotencyKey");

CREATE UNIQUE INDEX "ProvisioningSession_active_deviceId_key"
    ON "ProvisioningSession"("deviceId")
    WHERE "status" = 'ACTIVE';

CREATE INDEX "ProvisioningSession_deviceId_status_expiresAt_idx"
    ON "ProvisioningSession"("deviceId", "status", "expiresAt");

CREATE INDEX "ProvisioningSession_actorAccountId_createdAt_idx"
    ON "ProvisioningSession"("actorAccountId", "createdAt");

CREATE INDEX "ProvisioningSession_storeId_status_expiresAt_idx"
    ON "ProvisioningSession"("storeId", "status", "expiresAt");

ALTER TABLE "ProvisioningSession"
    ADD CONSTRAINT "ProvisioningSession_deviceId_storeId_fkey"
    FOREIGN KEY ("deviceId", "storeId")
    REFERENCES "Device"("id", "storeId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "ProvisioningSession_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "ProvisioningSession_actorAccountId_fkey"
    FOREIGN KEY ("actorAccountId") REFERENCES "Account"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
