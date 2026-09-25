-- Enterprise provisioning routing, worker accounting, and hot-path indexes.

CREATE TABLE IF NOT EXISTS "node_workers" (
  "id" TEXT NOT NULL,
  "node_id" TEXT NOT NULL,
  "active_tasks" INTEGER NOT NULL DEFAULT 0,
  "max_tasks" INTEGER NOT NULL DEFAULT 1,
  "queued_tasks" INTEGER NOT NULL DEFAULT 0,
  "last_task" TIMESTAMP(3),
  "health" TEXT NOT NULL DEFAULT 'unknown',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "node_workers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "node_workers_node_id_key" ON "node_workers"("node_id");
CREATE INDEX IF NOT EXISTS "node_workers_health_idx" ON "node_workers"("health");
CREATE INDEX IF NOT EXISTS "node_workers_active_tasks_max_tasks_idx" ON "node_workers"("active_tasks", "max_tasks");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'node_workers_node_id_fkey'
  ) THEN
    ALTER TABLE "node_workers"
      ADD CONSTRAINT "node_workers_node_id_fkey"
      FOREIGN KEY ("node_id") REFERENCES "proxmox_nodes"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "node_workers" ("id", "node_id", "max_tasks", "health", "updated_at")
SELECT CONCAT('node_worker_', n."id"), n."id", 1, COALESCE(NULLIF(n."status", ''), 'unknown'), CURRENT_TIMESTAMP
FROM "proxmox_nodes" n
ON CONFLICT ("node_id") DO NOTHING;

CREATE INDEX IF NOT EXISTS "orders_status_deleted_created_idx"
  ON "orders"("status", "deletedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "orders_customer_status_deleted_idx"
  ON "orders"("customerId", "status", "deletedAt");
CREATE INDEX IF NOT EXISTS "vps_instances_node_status_deleted_idx"
  ON "vps_instances"("proxmoxNodeId", "status", "deletedAt");
CREATE INDEX IF NOT EXISTS "vps_instances_customer_status_deleted_idx"
  ON "vps_instances"("customerId", "status", "deletedAt");
CREATE INDEX IF NOT EXISTS "ip_allocations_pool_status_released_idx"
  ON "ip_allocations"("poolId", "status", "releasedAt");
CREATE INDEX IF NOT EXISTS "os_templates_node_active_family_version_idx"
  ON "os_templates"("proxmoxNodeId", "isActive", "osFamily", "osVersion");

ALTER TABLE "system_settings"
  ADD COLUMN IF NOT EXISTS "ram_threshold_percent" INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS "maintenance_mode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "auto_failover" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "windows_only" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "linux_only" BOOLEAN NOT NULL DEFAULT false;

UPDATE "node_workers"
SET "max_tasks" = CASE
  WHEN lower(COALESCE(nc."name", '')) LIKE '%enterprise%' OR lower(COALESCE(nc."slug", '')) LIKE '%enterprise%' THEN GREATEST("node_workers"."max_tasks", 10)
  WHEN lower(COALESCE(nc."name", '')) LIKE '%large%' OR lower(COALESCE(nc."slug", '')) LIKE '%large%' THEN GREATEST("node_workers"."max_tasks", 6)
  WHEN lower(COALESCE(nc."name", '')) LIKE '%medium%' OR lower(COALESCE(nc."slug", '')) LIKE '%medium%' THEN GREATEST("node_workers"."max_tasks", 4)
  ELSE GREATEST("node_workers"."max_tasks", 2)
END
FROM "proxmox_nodes" pn
LEFT JOIN "node_classes" nc ON nc."id" = pn."nodeClassId"
WHERE "node_workers"."node_id" = pn."id";
