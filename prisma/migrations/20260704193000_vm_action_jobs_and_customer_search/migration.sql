CREATE TABLE "vm_action_jobs" (
  "id" TEXT NOT NULL,
  "vps_instance_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "proxmox_node_id" TEXT NOT NULL,
  "node_name" TEXT NOT NULL,
  "vmid" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "dedupe_key" TEXT,
  "request_id" TEXT NOT NULL,
  "requested_by" TEXT NOT NULL,
  "requested_role" TEXT NOT NULL,
  "latest_upid" TEXT,
  "result" JSONB NOT NULL DEFAULT '{}',
  "error_code" TEXT,
  "error" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "lease_owner" TEXT,
  "claimed_at" TIMESTAMP(3),
  "heartbeat_at" TIMESTAMP(3),
  "lease_expires_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vm_action_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vm_action_jobs_vps_instance_id_fkey" FOREIGN KEY ("vps_instance_id") REFERENCES "vps_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "vm_action_jobs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "vm_action_jobs_proxmox_node_id_fkey" FOREIGN KEY ("proxmox_node_id") REFERENCES "proxmox_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "vm_action_jobs_dedupe_key_key" ON "vm_action_jobs"("dedupe_key");
CREATE UNIQUE INDEX "vm_action_jobs_request_id_key" ON "vm_action_jobs"("request_id");
CREATE INDEX "vm_action_jobs_status_created_at_idx" ON "vm_action_jobs"("status", "created_at");
CREATE INDEX "vm_action_jobs_status_lease_expires_at_idx" ON "vm_action_jobs"("status", "lease_expires_at");
CREATE INDEX "vm_action_jobs_vps_instance_id_created_at_idx" ON "vm_action_jobs"("vps_instance_id", "created_at");
CREATE INDEX "vm_action_jobs_customer_id_created_at_idx" ON "vm_action_jobs"("customer_id", "created_at");
CREATE INDEX "vm_action_jobs_proxmox_node_id_vmid_created_at_idx" ON "vm_action_jobs"("proxmox_node_id", "vmid", "created_at");

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "customers_name_trgm_idx" ON "customers" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "customers_email_trgm_idx" ON "customers" USING GIN ("email" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "customers_phone_trgm_idx" ON "customers" USING GIN ("phone" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "customers_phone_number_trgm_idx" ON "customers" USING GIN ("phone_number" gin_trgm_ops);

CREATE TABLE "vm_reconciliation_incidents" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUARANTINED',
  "proxmox_node_id" TEXT,
  "node_name" TEXT,
  "vmid" INTEGER,
  "vps_instance_id" TEXT,
  "order_id" TEXT,
  "customer_id" TEXT,
  "reason" TEXT NOT NULL,
  "evidence" JSONB NOT NULL DEFAULT '{}',
  "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "resolution" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vm_reconciliation_incidents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vm_reconciliation_incidents_fingerprint_key" ON "vm_reconciliation_incidents"("fingerprint");
CREATE INDEX "vm_reconciliation_incidents_status_type_detected_at_idx" ON "vm_reconciliation_incidents"("status", "type", "detected_at");
CREATE INDEX "vm_reconciliation_incidents_proxmox_node_id_vmid_idx" ON "vm_reconciliation_incidents"("proxmox_node_id", "vmid");
CREATE INDEX "vm_reconciliation_incidents_vps_instance_id_idx" ON "vm_reconciliation_incidents"("vps_instance_id");
CREATE INDEX "vm_reconciliation_incidents_order_id_idx" ON "vm_reconciliation_incidents"("order_id");
