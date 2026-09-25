ALTER TABLE "provisioning_jobs"
  ADD COLUMN IF NOT EXISTS "canonical_phase" TEXT NOT NULL DEFAULT 'NEW',
  ADD COLUMN IF NOT EXISTS "resume_phase" TEXT;

CREATE TABLE IF NOT EXISTS "vm_provisioning_identities" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "vps_instance_id" TEXT,
  "vm_uuid" TEXT NOT NULL,
  "proxmox_node_id" TEXT,
  "vmid" INTEGER,
  "public_ip" TEXT,
  "mac_address" TEXT,
  "phase" TEXT NOT NULL DEFAULT 'NEW',
  "resume_phase" TEXT,
  "clone_intent_at" TIMESTAMP(3),
  "clone_completed_at" TIMESTAMP(3),
  "clone_upid" TEXT,
  "lease_owner" TEXT,
  "lease_heartbeat_at" TIMESTAMP(3),
  "lease_expires_at" TIMESTAMP(3),
  "replacement_generation" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vm_provisioning_identities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vm_provisioning_identities_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "vm_provisioning_identities_vps_instance_id_fkey" FOREIGN KEY ("vps_instance_id") REFERENCES "vps_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "vm_provisioning_identities_proxmox_node_id_fkey" FOREIGN KEY ("proxmox_node_id") REFERENCES "proxmox_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "vm_provisioning_identities_order_id_key" ON "vm_provisioning_identities"("order_id");
CREATE UNIQUE INDEX IF NOT EXISTS "vm_provisioning_identities_vps_instance_id_key" ON "vm_provisioning_identities"("vps_instance_id") WHERE "vps_instance_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "vm_provisioning_identities_vm_uuid_key" ON "vm_provisioning_identities"("vm_uuid");
CREATE INDEX IF NOT EXISTS "vm_provisioning_identities_phase_lease_expires_at_idx" ON "vm_provisioning_identities"("phase", "lease_expires_at");
CREATE INDEX IF NOT EXISTS "vm_provisioning_identities_proxmox_node_id_idx" ON "vm_provisioning_identities"("proxmox_node_id");

DO $$
DECLARE conflict_text TEXT;
BEGIN
  SELECT string_agg(vmid::text || ':' || count::text, ', ' ORDER BY vmid)
  INTO conflict_text
  FROM (
    SELECT vmid, count(*) AS count
    FROM "vps_instances"
    WHERE "deletedAt" IS NULL AND vmid > 0
    GROUP BY vmid
    HAVING count(*) > 1
  ) conflicts;
  IF conflict_text IS NOT NULL THEN
    RAISE EXCEPTION 'Global active VMID conflicts must be reviewed before migration: %', conflict_text;
  END IF;
  SELECT string_agg("ipAddress" || ':' || count::text, ', ' ORDER BY "ipAddress")
  INTO conflict_text
  FROM (
    SELECT "ipAddress", count(*) AS count
    FROM "vps_instances"
    WHERE "deletedAt" IS NULL AND "ipAddress" IS NOT NULL AND "ipAddress" <> ''
    GROUP BY "ipAddress"
    HAVING count(*) > 1
  ) conflicts;
  IF conflict_text IS NOT NULL THEN
    RAISE EXCEPTION 'Active public IP conflicts must be reviewed before migration: %', conflict_text;
  END IF;
END $$;

INSERT INTO "vm_provisioning_identities" (
  "id", "order_id", "vps_instance_id", "vm_uuid", "proxmox_node_id", "vmid", "public_ip", "mac_address", "phase", "resume_phase", "clone_completed_at", "metadata", "created_at", "updated_at"
)
SELECT
  'vpi_' || md5(v."orderId"),
  v."orderId",
  v.id,
  v.id,
  v."proxmoxNodeId",
  NULLIF(v.vmid, 0),
  NULLIF(BTRIM(v."ipAddress"), ''),
  NULLIF(BTRIM(v."vm_mac_address"), ''),
  CASE WHEN upper(v.status) IN ('ACTIVE', 'RUNNING', 'STOPPED', 'SUSPENDED') THEN 'READY' ELSE 'FAILED' END,
  CASE WHEN upper(v.status) IN ('ACTIVE', 'RUNNING', 'STOPPED', 'SUSPENDED') THEN 'READY' ELSE 'NEW' END,
  CASE WHEN v.vmid > 0 THEN COALESCE(v."activatedAt", v."createdAt") ELSE NULL END,
  jsonb_build_object('backfilled', true, 'backfilledAt', now()),
  v."createdAt",
  now()
FROM "vps_instances" v
WHERE v."deletedAt" IS NULL
ON CONFLICT ("order_id") DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS "vm_provisioning_identities_vmid_key" ON "vm_provisioning_identities"("vmid") WHERE "vmid" IS NOT NULL AND "vmid" > 0;
CREATE UNIQUE INDEX IF NOT EXISTS "vm_provisioning_identities_public_ip_key" ON "vm_provisioning_identities"("public_ip") WHERE "public_ip" IS NOT NULL AND "public_ip" <> '';

CREATE UNIQUE INDEX IF NOT EXISTS "vps_instances_active_global_vmid_unique"
  ON "vps_instances"("vmid")
  WHERE "deletedAt" IS NULL AND "vmid" > 0;
CREATE UNIQUE INDEX IF NOT EXISTS "vps_instances_active_public_ip_unique"
  ON "vps_instances"("ipAddress")
  WHERE "deletedAt" IS NULL AND "ipAddress" IS NOT NULL AND "ipAddress" <> '';

CREATE TABLE IF NOT EXISTS "duplicate_vm_incidents" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "vps_instance_id" TEXT,
  "proxmox_node_id" TEXT NOT NULL,
  "vmid" INTEGER NOT NULL,
  "primary_vmid" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUARANTINED',
  "detected_ip" TEXT,
  "detected_mac" TEXT,
  "detection_reason" TEXT NOT NULL,
  "primary_reason" TEXT NOT NULL,
  "notes_before" TEXT,
  "evidence" JSONB NOT NULL DEFAULT '{}',
  "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "stopped_at" TIMESTAMP(3),
  "approved_at" TIMESTAMP(3),
  "approved_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "deletion_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "duplicate_vm_incidents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "duplicate_vm_incidents_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "duplicate_vm_incidents_vps_instance_id_fkey" FOREIGN KEY ("vps_instance_id") REFERENCES "vps_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "duplicate_vm_incidents_proxmox_node_id_fkey" FOREIGN KEY ("proxmox_node_id") REFERENCES "proxmox_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "duplicate_vm_incidents_vmid_key" ON "duplicate_vm_incidents"("vmid");
CREATE INDEX IF NOT EXISTS "duplicate_vm_incidents_status_detected_at_idx" ON "duplicate_vm_incidents"("status", "detected_at");
CREATE INDEX IF NOT EXISTS "duplicate_vm_incidents_order_id_status_idx" ON "duplicate_vm_incidents"("order_id", "status");
CREATE INDEX IF NOT EXISTS "duplicate_vm_incidents_vps_instance_id_idx" ON "duplicate_vm_incidents"("vps_instance_id");
CREATE INDEX IF NOT EXISTS "duplicate_vm_incidents_proxmox_node_id_idx" ON "duplicate_vm_incidents"("proxmox_node_id");

UPDATE "provisioning_jobs" j
SET "canonical_phase" = CASE
  WHEN upper(COALESCE(j."currentStep", '')) IN ('ACTIVE', 'READY') OR j.status = 'completed' THEN 'READY'
  WHEN upper(COALESCE(j."currentStep", '')) IN ('VERIFYING_VM', 'WAITING_GUEST_AGENT') THEN 'WAITING_GUEST_AGENT'
  WHEN upper(COALESCE(j."currentStep", '')) = 'STARTING_VM' THEN 'STARTING'
  WHEN upper(COALESCE(j."currentStep", '')) IN ('ASSIGNING_IP', 'APPLYING_CLOUD_INIT') THEN 'SETTING_NETWORK'
  WHEN upper(COALESCE(j."currentStep", '')) = 'RESIZING_DISK' THEN 'RESIZING'
  WHEN upper(COALESCE(j."currentStep", '')) IN ('CONFIGURING_VM', 'CLONE_COMPLETE') THEN 'CONFIGURING'
  WHEN upper(COALESCE(j."currentStep", '')) = 'CLONING_TEMPLATE' THEN 'CLONING'
  WHEN j.status = 'failed' THEN 'FAILED'
  WHEN j.status = 'running' THEN 'LOCKED'
  ELSE 'NEW'
END,
"resume_phase" = COALESCE("resume_phase", "currentStep")
WHERE j.type = 'provision';
