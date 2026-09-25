ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "phone_number" TEXT,
  ADD COLUMN IF NOT EXISTS "phone_country_code" TEXT,
  ADD COLUMN IF NOT EXISTS "phone_verification_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "phone_otp_sent_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_login_ip" TEXT;

UPDATE "customers"
SET "phone_number" = regexp_replace("phone", '[^0-9+]', '', 'g')
WHERE "phone_number" IS NULL
  AND "phone" IS NOT NULL
  AND trim("phone") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "customers" duplicate
    WHERE duplicate.id <> "customers".id
      AND regexp_replace(duplicate."phone", '[^0-9+]', '', 'g') = regexp_replace("customers"."phone", '[^0-9+]', '', 'g')
  );

CREATE UNIQUE INDEX IF NOT EXISTS "customers_phone_number_key" ON "customers"("phone_number");

ALTER TABLE "vps_metrics"
  ADD COLUMN IF NOT EXISTS "disk_percent" DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE "vps_metrics"
SET "disk_percent" = CASE
  WHEN "disk_total_bytes" > 0 THEN LEAST(100, GREATEST(0, ("disk_used_bytes"::numeric / "disk_total_bytes"::numeric) * 100))::double precision
  ELSE 0
END;

ALTER TABLE "ip_pools"
  ADD COLUMN IF NOT EXISTS "subnet_key" TEXT,
  ADD COLUMN IF NOT EXISTS "inventory_mode" TEXT NOT NULL DEFAULT 'RANGE';

CREATE UNIQUE INDEX IF NOT EXISTS "ip_pools_subnet_key_key" ON "ip_pools"("subnet_key");

ALTER TABLE "provisioning_jobs"
  ADD COLUMN IF NOT EXISTS "lease_owner" TEXT,
  ADD COLUMN IF NOT EXISTS "heartbeat_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lease_expires_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "provisioning_jobs_status_lease_expires_at_idx" ON "provisioning_jobs"("status", "lease_expires_at");

ALTER TABLE "vm_deletion_jobs"
  ADD COLUMN IF NOT EXISTS "lease_owner" TEXT,
  ADD COLUMN IF NOT EXISTS "heartbeat_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lease_expires_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "vm_deletion_jobs_status_lease_expires_at_idx" ON "vm_deletion_jobs"("status", "lease_expires_at");

ALTER TABLE "backup_runs"
  ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "max_attempts" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "next_retry_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lease_owner" TEXT,
  ADD COLUMN IF NOT EXISTS "heartbeat_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lease_expires_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "backup_runs_status_lease_expires_at_idx" ON "backup_runs"("status", "lease_expires_at");

ALTER TABLE "cloudflare_accounts"
  ADD COLUMN IF NOT EXISTS "tunnel_token_encrypted" TEXT;

CREATE TABLE IF NOT EXISTS "vm_operation_locks" (
  "id" TEXT PRIMARY KEY,
  "vps_instance_id" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "owner_job_id" TEXT,
  "owner" TEXT,
  "heartbeat_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_expires_at" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "vm_operation_locks_vps_instance_id_key" ON "vm_operation_locks"("vps_instance_id");
CREATE INDEX IF NOT EXISTS "vm_operation_locks_operation_lease_expires_at_idx" ON "vm_operation_locks"("operation", "lease_expires_at");

CREATE TABLE IF NOT EXISTS "worker_heartbeats" (
  "queue_name" TEXT PRIMARY KEY,
  "worker_id" TEXT NOT NULL,
  "heartbeat_at" TIMESTAMP(3) NOT NULL,
  "last_success_at" TIMESTAMP(3),
  "last_error" TEXT,
  "processed" INTEGER NOT NULL DEFAULT 0,
  "errors" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "worker_heartbeats_heartbeat_at_idx" ON "worker_heartbeats"("heartbeat_at");

CREATE TABLE IF NOT EXISTS "ip_import_profiles" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "proxmox_node_id" TEXT,
  "cidr" INTEGER NOT NULL DEFAULT 24,
  "gateway" TEXT NOT NULL,
  "dns" TEXT NOT NULL,
  "bridge" TEXT NOT NULL,
  "region" TEXT,
  "pool_type" TEXT NOT NULL DEFAULT 'NORMAL',
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ip_import_profiles_proxmox_node_id_is_active_idx" ON "ip_import_profiles"("proxmox_node_id", "is_active");
CREATE INDEX IF NOT EXISTS "ip_import_profiles_is_default_is_active_idx" ON "ip_import_profiles"("is_default", "is_active");

CREATE TABLE IF NOT EXISTS "customer_import_jobs" (
  "id" TEXT PRIMARY KEY,
  "status" TEXT NOT NULL DEFAULT 'previewed',
  "file_name" TEXT,
  "row_count" INTEGER NOT NULL DEFAULT 0,
  "valid_count" INTEGER NOT NULL DEFAULT 0,
  "invalid_count" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "lease_owner" TEXT,
  "heartbeat_at" TIMESTAMP(3),
  "lease_expires_at" TIMESTAMP(3),
  "next_retry_at" TIMESTAMP(3),
  "error" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_by" TEXT,
  "committed_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "customer_import_jobs_status_next_retry_at_idx" ON "customer_import_jobs"("status", "next_retry_at");
CREATE INDEX IF NOT EXISTS "customer_import_jobs_lease_expires_at_idx" ON "customer_import_jobs"("lease_expires_at");
CREATE INDEX IF NOT EXISTS "customer_import_jobs_expires_at_idx" ON "customer_import_jobs"("expires_at");

CREATE TABLE IF NOT EXISTS "customer_import_rows" (
  "id" TEXT PRIMARY KEY,
  "job_id" TEXT NOT NULL,
  "row_number" INTEGER NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "password_encrypted" TEXT NOT NULL,
  "phone_number" TEXT,
  "country_code" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "validation_errors" JSONB NOT NULL DEFAULT '[]',
  "created_customer_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_import_rows_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "customer_import_jobs"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "customer_import_rows_job_id_row_number_key" ON "customer_import_rows"("job_id", "row_number");
CREATE INDEX IF NOT EXISTS "customer_import_rows_email_idx" ON "customer_import_rows"("email");
