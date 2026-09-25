-- The "ip_assignments" and "ip_history" tables were created out-of-band (referenced
-- throughout lib/ip-pool.ts, lib/provision.ts, lib/vm-addons.ts, lib/vm-db-truth.ts,
-- lib/vps-control.ts via `(prisma as any).ipAssignment` / `(prisma as any).ipHistory`)
-- but were never declared as Prisma models, so prisma.ipAssignment/.ipHistory did not
-- exist on the generated client. Every call site threw synchronously, which was caught
-- by upstream try/catch blocks and silently surfaced as IP_POOL_RANGE_INVALID, blocking
-- all IP allocation for provisioning. This migration is idempotent and matches the
-- existing production table structure exactly (no-op there); it exists so fresh
-- environments end up with the same schema.

CREATE TABLE IF NOT EXISTS "ip_assignments" (
  "id" TEXT NOT NULL,
  "vps_instance_id" TEXT NOT NULL,
  "customer_id" TEXT,
  "customer_email" TEXT,
  "vmid" INTEGER,
  "hostname" TEXT,
  "node_id" TEXT,
  "node_name" TEXT,
  "pool_id" TEXT,
  "pool_name" TEXT,
  "allocation_id" TEXT,
  "legacy_assignment_id" TEXT,
  "assigned_ip" TEXT NOT NULL,
  "gateway" TEXT,
  "cidr" INTEGER,
  "dns" TEXT,
  "bridge" TEXT,
  "is_primary" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL DEFAULT 'active',
  "assignment_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "released_at" TIMESTAMP(3),
  "billing_ip" TEXT,
  "cloud_init_ip" TEXT,
  "guest_agent_ip" TEXT,
  "proxmox_ip" TEXT,
  "source" TEXT NOT NULL DEFAULT 'database',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ip_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ip_assignments_vps_instance_id_status_idx" ON "ip_assignments"("vps_instance_id", "status");
CREATE INDEX IF NOT EXISTS "ip_assignments_assigned_ip_status_idx" ON "ip_assignments"("assigned_ip", "status");
CREATE INDEX IF NOT EXISTS "ip_assignments_pool_id_status_idx" ON "ip_assignments"("pool_id", "status");
CREATE INDEX IF NOT EXISTS "ip_assignments_node_id_vmid_idx" ON "ip_assignments"("node_id", "vmid");
CREATE INDEX IF NOT EXISTS "ip_assignments_assignment_date_idx" ON "ip_assignments"("assignment_date");
CREATE UNIQUE INDEX IF NOT EXISTS "ip_assignments_one_active_primary_per_vm_idx"
  ON "ip_assignments" ("vps_instance_id")
  WHERE ("is_primary" = true AND lower("status") = ANY (ARRAY['active','assigned','used','reserved','pending','moved']));

CREATE TABLE IF NOT EXISTS "ip_history" (
  "id" TEXT NOT NULL,
  "ip" TEXT NOT NULL,
  "assigned_ip" TEXT,
  "vps_instance_id" TEXT,
  "vmid" INTEGER,
  "customer_id" TEXT,
  "customer_email" TEXT,
  "customer_name" TEXT,
  "hostname" TEXT,
  "pool_id" TEXT,
  "pool_name" TEXT,
  "node_id" TEXT,
  "node_name" TEXT,
  "assignment_id" TEXT,
  "allocation_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "released_at" TIMESTAMP(3),
  "duration_days" INTEGER,
  "reason" TEXT,
  "admin" TEXT,
  "source" TEXT NOT NULL DEFAULT 'database',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ip_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ip_history_ip_assigned_at_idx" ON "ip_history"("ip", "assigned_at");
CREATE INDEX IF NOT EXISTS "ip_history_assigned_ip_assigned_at_idx" ON "ip_history"("assigned_ip", "assigned_at");
CREATE INDEX IF NOT EXISTS "ip_history_vps_instance_id_assigned_at_idx" ON "ip_history"("vps_instance_id", "assigned_at");
CREATE INDEX IF NOT EXISTS "ip_history_customer_id_assigned_at_idx" ON "ip_history"("customer_id", "assigned_at");
CREATE INDEX IF NOT EXISTS "ip_history_pool_id_status_idx" ON "ip_history"("pool_id", "status");
CREATE INDEX IF NOT EXISTS "ip_history_node_id_vmid_idx" ON "ip_history"("node_id", "vmid");
