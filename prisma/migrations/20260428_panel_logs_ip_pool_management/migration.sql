CREATE TABLE IF NOT EXISTS "panel_logs" (
  "id" TEXT NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "level" TEXT NOT NULL DEFAULT 'info',
  "category" TEXT NOT NULL,
  "actorType" TEXT,
  "actorId" TEXT,
  "actorEmail" TEXT,
  "customerId" TEXT,
  "orderId" TEXT,
  "vpsInstanceId" TEXT,
  "paymentId" TEXT,
  "vmid" INTEGER,
  "message" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "panel_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "panel_logs_timestamp_idx" ON "panel_logs"("timestamp");
CREATE INDEX IF NOT EXISTS "panel_logs_category_timestamp_idx" ON "panel_logs"("category", "timestamp");
CREATE INDEX IF NOT EXISTS "panel_logs_level_timestamp_idx" ON "panel_logs"("level", "timestamp");
CREATE INDEX IF NOT EXISTS "panel_logs_customerId_timestamp_idx" ON "panel_logs"("customerId", "timestamp");
CREATE INDEX IF NOT EXISTS "panel_logs_orderId_timestamp_idx" ON "panel_logs"("orderId", "timestamp");
CREATE INDEX IF NOT EXISTS "panel_logs_vpsInstanceId_timestamp_idx" ON "panel_logs"("vpsInstanceId", "timestamp");
CREATE INDEX IF NOT EXISTS "panel_logs_paymentId_timestamp_idx" ON "panel_logs"("paymentId", "timestamp");
CREATE INDEX IF NOT EXISTS "panel_logs_vmid_timestamp_idx" ON "panel_logs"("vmid", "timestamp");
