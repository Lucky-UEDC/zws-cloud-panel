CREATE TABLE IF NOT EXISTS "payment_validation_runs" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "trigger" TEXT NOT NULL DEFAULT 'admin_gateway_save',
  "gateway" TEXT,
  "commands" JSONB NOT NULL DEFAULT '[]',
  "output" JSONB NOT NULL DEFAULT '{}',
  "error_message" TEXT,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_validation_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "payment_validation_runs_status_created_at_idx" ON "payment_validation_runs"("status", "created_at");
CREATE INDEX IF NOT EXISTS "payment_validation_runs_gateway_created_at_idx" ON "payment_validation_runs"("gateway", "created_at");
