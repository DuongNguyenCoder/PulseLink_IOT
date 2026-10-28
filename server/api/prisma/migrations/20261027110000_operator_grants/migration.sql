-- Store-scoped operator authorization foundation.
-- Grant provisioning remains controlled and is intentionally not public.

CREATE TYPE "OperatorGrantStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "OperatorPermission" AS ENUM ('DEVICES_READ', 'DEVICES_WRITE');

CREATE TABLE "OperatorGrant" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "status" "OperatorGrantStatus" NOT NULL DEFAULT 'ACTIVE',
    "permissions" "OperatorPermission"[] NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OperatorGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperatorGrant_accountId_storeId_key"
    ON "OperatorGrant"("accountId", "storeId");
CREATE INDEX "OperatorGrant_storeId_status_idx"
    ON "OperatorGrant"("storeId", "status");
CREATE INDEX "OperatorGrant_accountId_status_idx"
    ON "OperatorGrant"("accountId", "status");

ALTER TABLE "OperatorGrant"
    ADD CONSTRAINT "OperatorGrant_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "OperatorGrant_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
