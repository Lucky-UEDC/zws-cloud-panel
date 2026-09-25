CREATE TABLE IF NOT EXISTS "integration_health_logs" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "action" TEXT NOT NULL DEFAULT 'health_check',
  "status" TEXT NOT NULL DEFAULT 'unknown',
  "latencyMs" INTEGER,
  "message" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "checkedBy" TEXT,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_health_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "integration_health_logs_provider_checkedAt_idx" ON "integration_health_logs"("provider", "checkedAt");
CREATE INDEX IF NOT EXISTS "integration_health_logs_status_checkedAt_idx" ON "integration_health_logs"("status", "checkedAt");

CREATE TABLE IF NOT EXISTS "deployment_snapshots" (
  "id" TEXT NOT NULL,
  "commit_hash" TEXT NOT NULL,
  "release_dir" TEXT,
  "backup_root" TEXT,
  "snapshot_label" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'created',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deployment_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "deployment_snapshots_commit_hash_idx" ON "deployment_snapshots"("commit_hash");
CREATE INDEX IF NOT EXISTS "deployment_snapshots_created_at_idx" ON "deployment_snapshots"("created_at");

CREATE TABLE IF NOT EXISTS "vm_deletion_jobs" (
  "id" TEXT NOT NULL,
  "vps_instance_id" TEXT NOT NULL,
  "order_id" TEXT,
  "customer_id" TEXT,
  "proxmox_node_id" TEXT,
  "vmid" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'delete_requested',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "next_retry_at" TIMESTAMP(3),
  "last_error" TEXT,
  "steps" JSONB NOT NULL DEFAULT '[]',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "requested_by" TEXT,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vm_deletion_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "vm_deletion_jobs_vps_instance_id_status_idx" ON "vm_deletion_jobs"("vps_instance_id", "status");
CREATE INDEX IF NOT EXISTS "vm_deletion_jobs_status_next_retry_at_idx" ON "vm_deletion_jobs"("status", "next_retry_at");
CREATE INDEX IF NOT EXISTS "vm_deletion_jobs_proxmox_node_id_vmid_idx" ON "vm_deletion_jobs"("proxmox_node_id", "vmid");

CREATE TABLE IF NOT EXISTS "notification_rules" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "channels" JSONB NOT NULL DEFAULT '[]',
  "schedule" JSONB NOT NULL DEFAULT '{}',
  "template" JSONB NOT NULL DEFAULT '{}',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "cooldown_sec" INTEGER NOT NULL DEFAULT 0,
  "retry_policy" JSONB NOT NULL DEFAULT '{}',
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "locale" TEXT,
  "updated_by" TEXT,
  "last_run_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_rules_key_key" ON "notification_rules"("key");
CREATE INDEX IF NOT EXISTS "notification_rules_event_type_enabled_idx" ON "notification_rules"("event_type", "enabled");
CREATE INDEX IF NOT EXISTS "notification_rules_last_run_at_idx" ON "notification_rules"("last_run_at");

CREATE TABLE IF NOT EXISTS "notification_delivery_logs" (
  "id" TEXT NOT NULL,
  "rule_key" TEXT,
  "event_type" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "recipient" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_retry_at" TIMESTAMP(3),
  "error" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "delivered_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_delivery_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "notification_delivery_logs_rule_key_created_at_idx" ON "notification_delivery_logs"("rule_key", "created_at");
CREATE INDEX IF NOT EXISTS "notification_delivery_logs_event_type_channel_status_idx" ON "notification_delivery_logs"("event_type", "channel", "status");
CREATE INDEX IF NOT EXISTS "notification_delivery_logs_status_next_retry_at_idx" ON "notification_delivery_logs"("status", "next_retry_at");
