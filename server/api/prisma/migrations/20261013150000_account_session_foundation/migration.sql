-- Additive Account / AppInstallation / Session / StoreMembership foundation.
-- This migration is an artifact only; it has not been applied by this change.

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "AppInstallationStatus" AS ENUM ('ACTIVE', 'REVOKED', 'INVALID');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'STAFF');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "SessionRevokeReason" AS ENUM ('LOGOUT', 'ROTATED', 'REUSE_DETECTED', 'ACCOUNT_DISABLED', 'PASSWORD_RESET', 'ADMIN_REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AccountTokenPurpose" AS ENUM ('PASSWORD_RESET', 'EMAIL_VERIFICATION');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "emailNormalized" VARCHAR(254) NOT NULL,
    "passwordHash" VARCHAR(512) NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'PENDING',
    "emailVerifiedAt" TIMESTAMP(3),
    "authVersion" INTEGER NOT NULL DEFAULT 0,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppInstallation" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "platform" "PushPlatform" NOT NULL,
    "fcmTokenCiphertext" TEXT NOT NULL,
    "fcmTokenFingerprint" VARCHAR(64) NOT NULL,
    "fcmTokenKeyVersion" INTEGER NOT NULL,
    "status" "AppInstallationStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokeReason" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "appInstallationId" TEXT NOT NULL,
    "refreshTokenHash" VARCHAR(128) NOT NULL,
    "tokenFamilyId" VARCHAR(64) NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "idleExpiresAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokeReason" "SessionRevokeReason",
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreMembership" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "StoreMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountToken" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "purpose" "AccountTokenPurpose" NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_emailNormalized_key" ON "Account"("emailNormalized");
CREATE INDEX "Account_status_idx" ON "Account"("status");
CREATE UNIQUE INDEX "AppInstallation_fcmTokenFingerprint_key" ON "AppInstallation"("fcmTokenFingerprint");
CREATE INDEX "AppInstallation_accountId_status_idx" ON "AppInstallation"("accountId", "status");
CREATE INDEX "AppInstallation_status_lastSeenAt_idx" ON "AppInstallation"("status", "lastSeenAt");
CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");
CREATE INDEX "Session_accountId_revokedAt_idx" ON "Session"("accountId", "revokedAt");
CREATE INDEX "Session_appInstallationId_revokedAt_idx" ON "Session"("appInstallationId", "revokedAt");
CREATE INDEX "Session_tokenFamilyId_generation_idx" ON "Session"("tokenFamilyId", "generation");
CREATE INDEX "Session_idleExpiresAt_absoluteExpiresAt_idx" ON "Session"("idleExpiresAt", "absoluteExpiresAt");
CREATE UNIQUE INDEX "StoreMembership_accountId_storeId_key" ON "StoreMembership"("accountId", "storeId");
CREATE INDEX "StoreMembership_accountId_status_idx" ON "StoreMembership"("accountId", "status");
CREATE INDEX "StoreMembership_storeId_status_role_idx" ON "StoreMembership"("storeId", "status", "role");
CREATE UNIQUE INDEX "AccountToken_tokenHash_key" ON "AccountToken"("tokenHash");
CREATE INDEX "AccountToken_accountId_purpose_expiresAt_idx" ON "AccountToken"("accountId", "purpose", "expiresAt");
CREATE INDEX "AccountToken_accountId_purpose_consumedAt_revokedAt_idx" ON "AccountToken"("accountId", "purpose", "consumedAt", "revokedAt");

-- MVP invariant: no Store may have more than one active Owner.
-- PostgreSQL partial uniqueness is used because Prisma schema indexes cannot express this predicate.
CREATE UNIQUE INDEX "StoreMembership_one_active_owner_per_store_key"
ON "StoreMembership"("storeId")
WHERE "role" = 'OWNER' AND "status" = 'ACTIVE';

-- AddForeignKey
ALTER TABLE "AppInstallation" ADD CONSTRAINT "AppInstallation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_appInstallationId_fkey" FOREIGN KEY ("appInstallationId") REFERENCES "AppInstallation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StoreMembership" ADD CONSTRAINT "StoreMembership_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StoreMembership" ADD CONSTRAINT "StoreMembership_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountToken" ADD CONSTRAINT "AccountToken_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
