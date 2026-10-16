-- Additive AuditEvent foundation. Application code only appends records.
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorType" VARCHAR(32) NOT NULL,
    "actorId" VARCHAR(128),
    "action" VARCHAR(100) NOT NULL,
    "resourceType" VARCHAR(80) NOT NULL,
    "resourceId" VARCHAR(128) NOT NULL,
    "storeId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL,
    "requestId" VARCHAR(128),

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditEvent_occurredAt_idx" ON "AuditEvent"("occurredAt");
CREATE INDEX "AuditEvent_actorType_actorId_occurredAt_idx" ON "AuditEvent"("actorType", "actorId", "occurredAt");
CREATE INDEX "AuditEvent_resourceType_resourceId_occurredAt_idx" ON "AuditEvent"("resourceType", "resourceId", "occurredAt");
CREATE INDEX "AuditEvent_storeId_occurredAt_idx" ON "AuditEvent"("storeId", "occurredAt");

ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
