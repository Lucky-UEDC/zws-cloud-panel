ALTER TABLE "vps_instances"
  ADD COLUMN IF NOT EXISTS "provisioningSource" TEXT NOT NULL DEFAULT 'panel',
  ADD COLUMN IF NOT EXISTS "ownershipStatus" TEXT NOT NULL DEFAULT 'panel_owned',
  ADD COLUMN IF NOT EXISTS "ownershipVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ownershipEvidence" JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS "vps_instances_provisioningSource_ownershipStatus_idx"
  ON "vps_instances"("provisioningSource", "ownershipStatus");

CREATE INDEX IF NOT EXISTS "vps_instances_ownershipVerifiedAt_idx"
  ON "vps_instances"("ownershipVerifiedAt");

CREATE TABLE IF NOT EXISTS "bandwidth_usage_samples" (
  "id" TEXT NOT NULL,
  "vps_instance_id" TEXT NOT NULL,
  "customer_id" TEXT,
  "product_id" TEXT,
  "proxmox_node_id" TEXT,
  "ip_address" TEXT,
  "vmid" INTEGER,
  "rx_bytes" BIGINT NOT NULL DEFAULT 0,
  "tx_bytes" BIGINT NOT NULL DEFAULT 0,
  "total_bytes" BIGINT NOT NULL DEFAULT 0,
  "rx_rate_bps" BIGINT NOT NULL DEFAULT 0,
  "tx_rate_bps" BIGINT NOT NULL DEFAULT 0,
  "peak_rate_bps" BIGINT NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL DEFAULT 'proxmox',
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "bandwidth_usage_samples_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "bandwidth_usage_rollups" (
  "id" TEXT NOT NULL,
  "scope_type" TEXT NOT NULL,
  "scope_id" TEXT NOT NULL,
  "vps_instance_id" TEXT,
  "customer_id" TEXT,
  "product_id" TEXT,
  "proxmox_node_id" TEXT,
  "ip_address" TEXT,
  "period" TEXT NOT NULL,
  "bucket_at" TIMESTAMP(3) NOT NULL,
  "rx_bytes" BIGINT NOT NULL DEFAULT 0,
  "tx_bytes" BIGINT NOT NULL DEFAULT 0,
  "total_bytes" BIGINT NOT NULL DEFAULT 0,
  "avg_rate_bps" BIGINT NOT NULL DEFAULT 0,
  "peak_rate_bps" BIGINT NOT NULL DEFAULT 0,
  "samples" INTEGER NOT NULL DEFAULT 0,
  "included_bytes" BIGINT NOT NULL DEFAULT 0,
  "billable_bytes" BIGINT NOT NULL DEFAULT 0,
  "estimated_inr" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bandwidth_usage_rollups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "bandwidth_usage_alerts" (
  "id" TEXT NOT NULL,
  "vps_instance_id" TEXT NOT NULL,
  "customer_id" TEXT,
  "alert_type" TEXT NOT NULL,
  "threshold_bytes" BIGINT NOT NULL DEFAULT 0,
  "current_bytes" BIGINT NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'open',
  "message" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  CONSTRAINT "bandwidth_usage_alerts_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bandwidth_usage_samples_vps_instance_id_fkey'
  ) THEN
    ALTER TABLE "bandwidth_usage_samples"
      ADD CONSTRAINT "bandwidth_usage_samples_vps_instance_id_fkey"
      FOREIGN KEY ("vps_instance_id") REFERENCES "vps_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bandwidth_usage_rollups_vps_instance_id_fkey'
  ) THEN
    ALTER TABLE "bandwidth_usage_rollups"
      ADD CONSTRAINT "bandwidth_usage_rollups_vps_instance_id_fkey"
      FOREIGN KEY ("vps_instance_id") REFERENCES "vps_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bandwidth_usage_alerts_vps_instance_id_fkey'
  ) THEN
    ALTER TABLE "bandwidth_usage_alerts"
      ADD CONSTRAINT "bandwidth_usage_alerts_vps_instance_id_fkey"
      FOREIGN KEY ("vps_instance_id") REFERENCES "vps_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "bandwidth_usage_samples_vps_instance_id_recorded_at_idx"
  ON "bandwidth_usage_samples"("vps_instance_id", "recorded_at");
CREATE INDEX IF NOT EXISTS "bandwidth_usage_samples_customer_id_recorded_at_idx"
  ON "bandwidth_usage_samples"("customer_id", "recorded_at");
CREATE INDEX IF NOT EXISTS "bandwidth_usage_samples_product_id_recorded_at_idx"
  ON "bandwidth_usage_samples"("product_id", "recorded_at");
CREATE INDEX IF NOT EXISTS "bandwidth_usage_samples_proxmox_node_id_recorded_at_idx"
  ON "bandwidth_usage_samples"("proxmox_node_id", "recorded_at");
CREATE INDEX IF NOT EXISTS "bandwidth_usage_samples_ip_address_recorded_at_idx"
  ON "bandwidth_usage_samples"("ip_address", "recorded_at");
CREATE INDEX IF NOT EXISTS "bandwidth_usage_samples_recorded_at_idx"
  ON "bandwidth_usage_samples"("recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "bandwidth_usage_rollups_scope_type_scope_id_period_bucket_at_key"
  ON "bandwidth_usage_rollups"("scope_type", "scope_id", "period", "bucket_at");
CREATE INDEX IF NOT EXISTS "bandwidth_usage_rollups_vps_instance_id_period_bucket_at_idx"
  ON "bandwidth_usage_rollups"("vps_instance_id", "period", "bucket_at");
CREATE INDEX IF NOT EXISTS "bandwidth_usage_rollups_customer_id_period_bucket_at_idx"
  ON "bandwidth_usage_rollups"("customer_id", "period", "bucket_at");
CREATE INDEX IF NOT EXISTS "bandwidth_usage_rollups_product_id_period_bucket_at_idx"
  ON "bandwidth_usage_rollups"("product_id", "period", "bucket_at");
CREATE INDEX IF NOT EXISTS "bandwidth_usage_rollups_proxmox_node_id_period_bucket_at_idx"
  ON "bandwidth_usage_rollups"("proxmox_node_id", "period", "bucket_at");
CREATE INDEX IF NOT EXISTS "bandwidth_usage_rollups_period_bucket_at_idx"
  ON "bandwidth_usage_rollups"("period", "bucket_at");

CREATE UNIQUE INDEX IF NOT EXISTS "bandwidth_usage_alerts_vps_instance_id_alert_type_status_key"
  ON "bandwidth_usage_alerts"("vps_instance_id", "alert_type", "status");
CREATE INDEX IF NOT EXISTS "bandwidth_usage_alerts_customer_id_status_last_seen_at_idx"
  ON "bandwidth_usage_alerts"("customer_id", "status", "last_seen_at");
CREATE INDEX IF NOT EXISTS "bandwidth_usage_alerts_alert_type_status_idx"
  ON "bandwidth_usage_alerts"("alert_type", "status");
