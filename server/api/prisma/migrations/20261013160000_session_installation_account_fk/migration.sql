-- Additive integrity fix for the Session/AppInstallation account binding.
-- Apply only after a preflight confirms that existing rows satisfy the
-- composite relationship. No data backfill or repair is performed here.

CREATE UNIQUE INDEX "AppInstallation_id_accountId_key"
    ON "AppInstallation"("id", "accountId");

ALTER TABLE "Session"
    ADD CONSTRAINT "Session_appInstallationId_accountId_fkey"
    FOREIGN KEY ("appInstallationId", "accountId")
    REFERENCES "AppInstallation"("id", "accountId")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
