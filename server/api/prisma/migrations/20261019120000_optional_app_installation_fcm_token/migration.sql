-- Allow an AppInstallation to exist before Firebase has issued a token.
-- Existing encrypted token material is preserved unchanged.
ALTER TABLE "AppInstallation"
  ALTER COLUMN "fcmTokenCiphertext" DROP NOT NULL,
  ALTER COLUMN "fcmTokenFingerprint" DROP NOT NULL,
  ALTER COLUMN "fcmTokenKeyVersion" DROP NOT NULL;
