-- Durable worker heartbeat for queue health diagnostics. This migration is
-- additive and intentionally does not alter notification delivery semantics.
CREATE TABLE "NotificationWorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "workerId" VARCHAR(128) NOT NULL,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL,
    "lastProcessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationWorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationWorkerHeartbeat_workerId_key"
  ON "NotificationWorkerHeartbeat"("workerId");

CREATE INDEX "NotificationWorkerHeartbeat_lastHeartbeatAt_idx"
  ON "NotificationWorkerHeartbeat"("lastHeartbeatAt");
