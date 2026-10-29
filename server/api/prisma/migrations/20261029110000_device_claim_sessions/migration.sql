CREATE TABLE "DeviceClaimSession" (
    "id" TEXT NOT NULL,
    "deviceId" VARCHAR(128) NOT NULL,
    "storeId" TEXT NOT NULL,
    "actorAccountId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "challengeHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceClaimSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeviceClaimSession_deviceId_expiresAt_consumedAt_idx"
    ON "DeviceClaimSession"("deviceId", "expiresAt", "consumedAt");
CREATE INDEX "DeviceClaimSession_storeId_createdAt_idx"
    ON "DeviceClaimSession"("storeId", "createdAt");
CREATE INDEX "DeviceClaimSession_actorAccountId_createdAt_idx"
    ON "DeviceClaimSession"("actorAccountId", "createdAt");

ALTER TABLE "DeviceClaimSession"
    ADD CONSTRAINT "DeviceClaimSession_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeviceClaimSession"
    ADD CONSTRAINT "DeviceClaimSession_actorAccountId_fkey"
    FOREIGN KEY ("actorAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
