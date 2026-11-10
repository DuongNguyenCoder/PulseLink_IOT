-- Store invitation lifecycle. Invitation rows never grant access by themselves.
CREATE TYPE "StoreInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

CREATE TABLE "StoreInvitation" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "inviterAccountId" TEXT NOT NULL,
    "recipientEmailNormalized" VARCHAR(254) NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "status" "StoreInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "role" "MembershipRole" NOT NULL DEFAULT 'STAFF',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoreInvitation_tokenHash_key" ON "StoreInvitation"("tokenHash");
CREATE INDEX "StoreInvitation_storeId_status_createdAt_idx" ON "StoreInvitation"("storeId", "status", "createdAt");
CREATE INDEX "StoreInvitation_storeId_recipientEmailNormalized_status_idx" ON "StoreInvitation"("storeId", "recipientEmailNormalized", "status");
CREATE INDEX "StoreInvitation_status_expiresAt_idx" ON "StoreInvitation"("status", "expiresAt");
CREATE UNIQUE INDEX "StoreInvitation_one_pending_per_recipient_key"
ON "StoreInvitation"("storeId", "recipientEmailNormalized")
WHERE "status" = 'PENDING';

ALTER TABLE "StoreInvitation" ADD CONSTRAINT "StoreInvitation_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StoreInvitation" ADD CONSTRAINT "StoreInvitation_inviterAccountId_fkey"
  FOREIGN KEY ("inviterAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
