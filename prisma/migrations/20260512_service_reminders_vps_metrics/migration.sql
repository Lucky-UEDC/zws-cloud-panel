CREATE TABLE IF NOT EXISTS "service_reminders" (
  "id" TEXT NOT NULL,
  "service_id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "reminder_type" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'sent',
  "provider_message_id" TEXT,
  "error" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_reminders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "service_reminders_service_id_invoice_id_reminder_type_channel_key"
  ON "service_reminders"("service_id", "invoice_id", "reminder_type", "channel");
CREATE INDEX IF NOT EXISTS "service_reminders_service_id_sent_at_idx" ON "service_reminders"("service_id", "sent_at");
CREATE INDEX IF NOT EXISTS "service_reminders_invoice_id_sent_at_idx" ON "service_reminders"("invoice_id", "sent_at");
CREATE INDEX IF NOT EXISTS "service_reminders_reminder_type_channel_idx" ON "service_reminders"("reminder_type", "channel");
CREATE INDEX IF NOT EXISTS "service_reminders_status_sent_at_idx" ON "service_reminders"("status", "sent_at");

CREATE TABLE IF NOT EXISTS "vps_metrics" (
  "id" TEXT NOT NULL,
  "vps_instance_id" TEXT NOT NULL,
  "vmid" INTEGER,
  "runtime_status" TEXT,
  "cpu_percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ram_used_bytes" BIGINT NOT NULL DEFAULT 0,
  "ram_total_bytes" BIGINT NOT NULL DEFAULT 0,
  "disk_used_bytes" BIGINT NOT NULL DEFAULT 0,
  "disk_total_bytes" BIGINT NOT NULL DEFAULT 0,
  "disk_read_bytes" BIGINT NOT NULL DEFAULT 0,
  "disk_write_bytes" BIGINT NOT NULL DEFAULT 0,
  "network_in_bytes" BIGINT NOT NULL DEFAULT 0,
  "network_out_bytes" BIGINT NOT NULL DEFAULT 0,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "vps_metrics_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "vps_metrics_vps_instance_id_recorded_at_idx" ON "vps_metrics"("vps_instance_id", "recorded_at");
CREATE INDEX IF NOT EXISTS "vps_metrics_recorded_at_idx" ON "vps_metrics"("recorded_at");
