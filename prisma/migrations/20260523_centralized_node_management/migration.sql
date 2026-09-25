ALTER TABLE "node_storage_pool_configs"
  ADD COLUMN IF NOT EXISTS "defaultForVmDisk" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "defaultForTemplate" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "defaultForBackup" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS "healthStatus" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "supportedContent" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "lastHealthCheckedAt" TIMESTAMP(3);

UPDATE "node_storage_pool_configs"
SET "defaultForVmDisk" = true
WHERE "defaultForNewVm" = true AND "defaultForVmDisk" = false;

UPDATE "node_storage_pool_configs"
SET "priority" = COALESCE("sortOrder", 0)
WHERE "priority" = 100 AND COALESCE("sortOrder", 0) <> 0;

CREATE INDEX IF NOT EXISTS "node_storage_pool_configs_proxmoxNodeId_defaultForVmDisk_idx"
  ON "node_storage_pool_configs"("proxmoxNodeId", "defaultForVmDisk");
CREATE INDEX IF NOT EXISTS "node_storage_pool_configs_proxmoxNodeId_defaultForTemplate_idx"
  ON "node_storage_pool_configs"("proxmoxNodeId", "defaultForTemplate");
CREATE INDEX IF NOT EXISTS "node_storage_pool_configs_proxmoxNodeId_defaultForBackup_idx"
  ON "node_storage_pool_configs"("proxmoxNodeId", "defaultForBackup");
CREATE INDEX IF NOT EXISTS "node_storage_pool_configs_proxmoxNodeId_enabled_priority_idx"
  ON "node_storage_pool_configs"("proxmoxNodeId", "enabled", "priority");
