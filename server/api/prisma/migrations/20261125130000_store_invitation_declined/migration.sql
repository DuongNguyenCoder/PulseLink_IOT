-- A recipient decline is distinct from an Owner revoke.
ALTER TYPE "StoreInvitationStatus" ADD VALUE 'DECLINED';

ALTER TABLE "StoreInvitation"
  ADD COLUMN "declinedAt" TIMESTAMP(3);
