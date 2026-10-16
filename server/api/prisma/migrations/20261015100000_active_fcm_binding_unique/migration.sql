-- Replace global fingerprint uniqueness with active-binding uniqueness.
-- Revoked/invalid bindings retain their fingerprint without preventing a
-- token from being rebound to its newest installation.
DROP INDEX IF EXISTS "AppInstallation_fcmTokenFingerprint_key";

CREATE UNIQUE INDEX "AppInstallation_active_fcmTokenFingerprint_key"
ON "AppInstallation"("fcmTokenFingerprint")
WHERE "status" = 'ACTIVE';
