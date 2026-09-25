CREATE TABLE IF NOT EXISTS "payment_webhook_logs" (
  "id" TEXT NOT NULL,
  "gateway" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "event_type" TEXT,
  "status" TEXT NOT NULL,
  "payload" JSONB,
  "response" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_webhook_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "payment_webhook_logs_gateway_status_created_at_idx" ON "payment_webhook_logs"("gateway", "status", "created_at");
CREATE INDEX IF NOT EXISTS "payment_webhook_logs_gateway_event_id_idx" ON "payment_webhook_logs"("gateway", "event_id");
