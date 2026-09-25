CREATE TABLE IF NOT EXISTS "audit_events" (
  "id" TEXT NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "eventType" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'INFO',
  "actorType" TEXT,
  "actorId" TEXT,
  "actorEmail" TEXT,
  "targetType" TEXT,
  "targetId" TEXT,
  "vmId" TEXT,
  "vpsInstanceId" TEXT,
  "vmid" INTEGER,
  "orderId" TEXT,
  "customerId" TEXT,
  "nodeId" TEXT,
  "paymentId" TEXT,
  "oldValue" JSONB,
  "newValue" JSONB,
  "reason" TEXT,
  "metadataJson" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'SUCCESS',
  "requestId" TEXT,
  "correlationId" TEXT,
  "sourceIp" TEXT,
  "country" TEXT,
  "userAgent" TEXT,
  "durationMs" INTEGER,
  "immutable" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_events_timestamp_idx" ON "audit_events"("timestamp");
CREATE INDEX IF NOT EXISTS "audit_events_eventType_timestamp_idx" ON "audit_events"("eventType", "timestamp");
CREATE INDEX IF NOT EXISTS "audit_events_severity_timestamp_idx" ON "audit_events"("severity", "timestamp");
CREATE INDEX IF NOT EXISTS "audit_events_actorType_actorId_timestamp_idx" ON "audit_events"("actorType", "actorId", "timestamp");
CREATE INDEX IF NOT EXISTS "audit_events_actorEmail_timestamp_idx" ON "audit_events"("actorEmail", "timestamp");
CREATE INDEX IF NOT EXISTS "audit_events_targetType_targetId_timestamp_idx" ON "audit_events"("targetType", "targetId", "timestamp");
CREATE INDEX IF NOT EXISTS "audit_events_customerId_timestamp_idx" ON "audit_events"("customerId", "timestamp");
CREATE INDEX IF NOT EXISTS "audit_events_orderId_timestamp_idx" ON "audit_events"("orderId", "timestamp");
CREATE INDEX IF NOT EXISTS "audit_events_vpsInstanceId_timestamp_idx" ON "audit_events"("vpsInstanceId", "timestamp");
CREATE INDEX IF NOT EXISTS "audit_events_vmid_timestamp_idx" ON "audit_events"("vmid", "timestamp");
CREATE INDEX IF NOT EXISTS "audit_events_nodeId_timestamp_idx" ON "audit_events"("nodeId", "timestamp");
CREATE INDEX IF NOT EXISTS "audit_events_paymentId_timestamp_idx" ON "audit_events"("paymentId", "timestamp");
CREATE INDEX IF NOT EXISTS "audit_events_requestId_idx" ON "audit_events"("requestId");
CREATE INDEX IF NOT EXISTS "audit_events_correlationId_timestamp_idx" ON "audit_events"("correlationId", "timestamp");
