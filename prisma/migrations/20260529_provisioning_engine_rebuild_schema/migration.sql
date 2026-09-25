-- DB-backed provisioning capabilities, RAM-only scheduler settings, and
-- recovery of stale CPU-blocked jobs.

ALTER TABLE "system_settings"
  ADD COLUMN IF NOT EXISTS "ram_threshold_percent" INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS "maintenance_mode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "auto_failover" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "windows_only" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "linux_only" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "proxmox_nodes"
  ADD COLUMN IF NOT EXISTS "supported_os_types" "NodeProvisioningMode" NOT NULL DEFAULT 'HYBRID';

ALTER TABLE "proxmox_nodes"
  ALTER COLUMN "provisioningMode" SET DEFAULT 'HYBRID',
  ALTER COLUMN "supported_os_types" SET DEFAULT 'HYBRID';

UPDATE "proxmox_nodes"
SET "supported_os_types" = CASE
  WHEN "provisioningMode" = 'ALL_OS' THEN 'HYBRID'::"NodeProvisioningMode"
  ELSE "provisioningMode"
END
WHERE "supported_os_types" IS NULL OR "supported_os_types" = 'ALL_OS';

UPDATE "proxmox_nodes"
SET "provisioningMode" = 'HYBRID'::"NodeProvisioningMode"
WHERE "provisioningMode" = 'ALL_OS';

UPDATE "os_templates"
SET "osFamily" = CASE
  WHEN lower(coalesce("osFamily", '') || ' ' || coalesce("category", '') || ' ' || coalesce("osType", '') || ' ' || coalesce("name", '') || ' ' || coalesce("slug", '')) ~ '(windows|winserver|win\s*server|win11|server\s*20[0-9]{2})' THEN 'windows'
  WHEN lower(coalesce("osFamily", '') || ' ' || coalesce("category", '') || ' ' || coalesce("name", '') || ' ' || coalesce("slug", '')) ~ 'ubuntu' THEN 'ubuntu'
  WHEN lower(coalesce("osFamily", '') || ' ' || coalesce("category", '') || ' ' || coalesce("name", '') || ' ' || coalesce("slug", '')) ~ 'debian' THEN 'debian'
  WHEN lower(coalesce("osFamily", '') || ' ' || coalesce("category", '') || ' ' || coalesce("name", '') || ' ' || coalesce("slug", '')) ~ '(alma\s*linux|almalinux|alma)' THEN 'alma'
  WHEN lower(coalesce("osFamily", '') || ' ' || coalesce("category", '') || ' ' || coalesce("name", '') || ' ' || coalesce("slug", '')) ~ '(rocky\s*linux|rockylinux|rocky)' THEN 'rocky'
  WHEN lower(coalesce("osFamily", '') || ' ' || coalesce("category", '') || ' ' || coalesce("name", '') || ' ' || coalesce("slug", '')) ~ '(cent\s*os|centos)' THEN 'centos'
  ELSE lower(coalesce(nullif("osFamily", ''), nullif("category", ''), 'linux'))
END
WHERE "isActive" = true;

UPDATE "os_templates"
SET "category" = CASE WHEN "osFamily" = 'windows' THEN 'windows' ELSE 'linux' END
WHERE "osFamily" IN ('windows', 'ubuntu', 'debian', 'centos', 'alma', 'rocky');

CREATE TABLE IF NOT EXISTS "node_capabilities" (
  "id" TEXT NOT NULL,
  "node_id" TEXT NOT NULL,
  "supported_os_types" "NodeProvisioningMode" NOT NULL DEFAULT 'HYBRID',
  "os_families" JSONB NOT NULL DEFAULT '[]',
  "auto_detected" BOOLEAN NOT NULL DEFAULT true,
  "source" TEXT NOT NULL DEFAULT 'scheduler',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "node_capabilities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "node_limits" (
  "id" TEXT NOT NULL,
  "node_id" TEXT NOT NULL,
  "ram_threshold_percent" INTEGER NOT NULL DEFAULT 90,
  "max_concurrent_tasks" INTEGER NOT NULL DEFAULT 1,
  "storage_reserve_gb" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "node_limits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "template_capabilities" (
  "id" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "os_family" TEXT NOT NULL,
  "os_kind" TEXT NOT NULL DEFAULT 'linux',
  "compatible_os_types" JSONB NOT NULL DEFAULT '[]',
  "auto_detected" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "template_capabilities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "scheduler_rules" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "config" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scheduler_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "node_capabilities_node_id_key" ON "node_capabilities"("node_id");
CREATE INDEX IF NOT EXISTS "node_capabilities_supported_os_types_idx" ON "node_capabilities"("supported_os_types");
CREATE UNIQUE INDEX IF NOT EXISTS "node_limits_node_id_key" ON "node_limits"("node_id");
CREATE UNIQUE INDEX IF NOT EXISTS "template_capabilities_template_id_key" ON "template_capabilities"("template_id");
CREATE INDEX IF NOT EXISTS "template_capabilities_os_family_os_kind_idx" ON "template_capabilities"("os_family", "os_kind");
CREATE UNIQUE INDEX IF NOT EXISTS "scheduler_rules_key_key" ON "scheduler_rules"("key");
CREATE INDEX IF NOT EXISTS "scheduler_rules_enabled_priority_idx" ON "scheduler_rules"("enabled", "priority");
CREATE INDEX IF NOT EXISTS "proxmox_nodes_supported_os_types_isActive_idx" ON "proxmox_nodes"("supported_os_types", "isActive");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'node_capabilities_node_id_fkey') THEN
    ALTER TABLE "node_capabilities"
      ADD CONSTRAINT "node_capabilities_node_id_fkey"
      FOREIGN KEY ("node_id") REFERENCES "proxmox_nodes"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'node_limits_node_id_fkey') THEN
    ALTER TABLE "node_limits"
      ADD CONSTRAINT "node_limits_node_id_fkey"
      FOREIGN KEY ("node_id") REFERENCES "proxmox_nodes"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'template_capabilities_template_id_fkey') THEN
    ALTER TABLE "template_capabilities"
      ADD CONSTRAINT "template_capabilities_template_id_fkey"
      FOREIGN KEY ("template_id") REFERENCES "os_templates"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "node_capabilities" ("id", "node_id", "supported_os_types", "os_families", "metadata", "updated_at")
SELECT
  CONCAT('node_capability_', n."id"),
  n."id",
  n."supported_os_types",
  COALESCE((
    SELECT jsonb_agg(DISTINCT t."osFamily")
    FROM "os_templates" t
    WHERE t."proxmoxNodeId" = n."id"
      AND t."isActive" = true
      AND t."osFamily" IS NOT NULL
  ), '[]'::jsonb),
  jsonb_build_object('seededBy', 'provisioning_engine_rebuild_schema'),
  CURRENT_TIMESTAMP
FROM "proxmox_nodes" n
ON CONFLICT ("node_id") DO UPDATE SET
  "supported_os_types" = EXCLUDED."supported_os_types",
  "os_families" = EXCLUDED."os_families",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "node_limits" ("id", "node_id", "ram_threshold_percent", "max_concurrent_tasks", "metadata", "updated_at")
SELECT
  CONCAT('node_limit_', n."id"),
  n."id",
  COALESCE((SELECT "ram_threshold_percent" FROM "system_settings" WHERE "active" = true ORDER BY "updatedAt" DESC LIMIT 1), 90),
  COALESCE(w."max_tasks", 1),
  jsonb_build_object('cpuIgnoredForPlacement', true),
  CURRENT_TIMESTAMP
FROM "proxmox_nodes" n
LEFT JOIN "node_workers" w ON w."node_id" = n."id"
ON CONFLICT ("node_id") DO UPDATE SET
  "ram_threshold_percent" = EXCLUDED."ram_threshold_percent",
  "max_concurrent_tasks" = EXCLUDED."max_concurrent_tasks",
  "metadata" = EXCLUDED."metadata",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "template_capabilities" ("id", "template_id", "os_family", "os_kind", "compatible_os_types", "metadata", "updated_at")
SELECT
  CONCAT('template_capability_', t."id"),
  t."id",
  COALESCE(NULLIF(t."osFamily", ''), 'linux'),
  CASE WHEN t."osFamily" = 'windows' THEN 'windows' ELSE 'linux' END,
  CASE WHEN t."osFamily" = 'windows' THEN '["WINDOWS_ONLY","HYBRID"]'::jsonb ELSE '["LINUX_ONLY","HYBRID"]'::jsonb END,
  jsonb_build_object('seededBy', 'provisioning_engine_rebuild_schema'),
  CURRENT_TIMESTAMP
FROM "os_templates" t
WHERE t."isActive" = true
ON CONFLICT ("template_id") DO UPDATE SET
  "os_family" = EXCLUDED."os_family",
  "os_kind" = EXCLUDED."os_kind",
  "compatible_os_types" = EXCLUDED."compatible_os_types",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "scheduler_rules" ("id", "key", "enabled", "priority", "config", "metadata", "updated_at")
VALUES
  ('scheduler_rule_ram_only_capacity', 'ram_only_capacity', true, 10, '{"cpuBlocksPlacement": false, "requiredFreeRamComparator": ">"}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP),
  ('scheduler_rule_os_enum_matching', 'os_enum_matching', true, 20, '{"windows":["WINDOWS_ONLY","HYBRID"],"linux":["LINUX_ONLY","HYBRID"]}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP),
  ('scheduler_rule_first_available_ip', 'first_available_ip', true, 30, '{"strategy":"first_available_compatible_pool"}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
  "enabled" = EXCLUDED."enabled",
  "priority" = EXCLUDED."priority",
  "config" = EXCLUDED."config",
  "updated_at" = CURRENT_TIMESTAMP;

UPDATE "provisioning_jobs"
SET
  "status" = 'queued',
  "currentStep" = 'QUEUED',
  "displayStatus" = 'Preparing your cloud server',
  "errorCode" = NULL,
  "error" = NULL,
  "nextRetryAt" = NULL,
  "claimedAt" = NULL,
  "completedAt" = NULL,
  "dedupeKey" = NULL,
  "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object('autoRecoveredFromCpuBlock', true, 'requeuedAt', CURRENT_TIMESTAMP)
WHERE "status" IN ('waiting_for_admin', 'failed')
  AND (
    "errorCode" = 'PREFLIGHT_CPU_CAPACITY_FAILED'
    OR lower(coalesce("error", '')) LIKE '%insufficient cpu%'
  );

UPDATE "orders"
SET
  "provisioningStatus" = 'QUEUED',
  "provisioningError" = NULL
WHERE "provisioningStatus" IN ('WAITING_FOR_ADMIN', 'FAILED', 'failed', 'waiting_for_admin')
  AND lower(coalesce("provisioningError", '')) LIKE '%insufficient cpu%';
