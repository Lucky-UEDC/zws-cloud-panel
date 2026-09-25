-- Production storage pool management controls.

ALTER TABLE "node_storage_pool_configs" ADD COLUMN IF NOT EXISTS "storageType" TEXT;
ALTER TABLE "node_storage_pool_configs" ADD COLUMN IF NOT EXISTS "customStorageLabel" TEXT;
ALTER TABLE "node_storage_pool_configs" ADD COLUMN IF NOT EXISTS "availableBytes" BIGINT;
ALTER TABLE "node_storage_pool_configs" ADD COLUMN IF NOT EXISTS "proxmoxType" TEXT;
ALTER TABLE "node_storage_pool_configs" ADD COLUMN IF NOT EXISTS "isPremium" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "node_storage_pool_configs" ADD COLUMN IF NOT EXISTS "isCustomerSelectable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "node_storage_pool_configs" ADD COLUMN IF NOT EXISTS "isUpgradeOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "node_storage_pool_configs" ADD COLUMN IF NOT EXISTS "minGb" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "node_storage_pool_configs" ADD COLUMN IF NOT EXISTS "maxGb" INTEGER;
ALTER TABLE "node_storage_pool_configs" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "node_storage_pool_configs" ADD COLUMN IF NOT EXISTS "lastSyncedAt" TIMESTAMP(3);
ALTER TABLE "node_storage_pool_configs" ADD COLUMN IF NOT EXISTS "missingFromProxmox" BOOLEAN NOT NULL DEFAULT false;

UPDATE "node_storage_pool_configs"
SET
  "storageType" = COALESCE("storageType", UPPER(COALESCE(NULLIF("type", ''), 'NVME'))),
  "proxmoxType" = COALESCE("proxmoxType", "type"),
  "availableBytes" = COALESCE("availableBytes", "freeBytes"),
  "isPremium" = COALESCE("isPremium", "premium", false),
  "isCustomerSelectable" = COALESCE("isCustomerSelectable", "allowNewPurchase", false),
  "isUpgradeOnly" = COALESCE("isUpgradeOnly", CASE WHEN "allowUpgrade" = true AND "allowNewPurchase" = false THEN true ELSE false END),
  "minGb" = GREATEST(COALESCE("minGb", 1), 1);

CREATE INDEX IF NOT EXISTS "node_storage_pool_configs_proxmoxNodeId_storageType_idx" ON "node_storage_pool_configs"("proxmoxNodeId", "storageType");
CREATE INDEX IF NOT EXISTS "node_storage_pool_configs_proxmoxNodeId_missingFromProxmox_idx" ON "node_storage_pool_configs"("proxmoxNodeId", "missingFromProxmox");
CREATE INDEX IF NOT EXISTS "node_storage_pool_configs_enabled_isUpgradeOnly_idx" ON "node_storage_pool_configs"("enabled", "isUpgradeOnly");

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "storagePolicyType" TEXT NOT NULL DEFAULT 'NODE_DEFAULT';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "requiredStorageType" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "requiredStoragePoolId" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "allowStorageFallback" BOOLEAN NOT NULL DEFAULT true;

UPDATE "products"
SET
  "storagePolicyType" = COALESCE(NULLIF("storagePolicyType", ''), 'NODE_DEFAULT'),
  "requiredStoragePoolId" = COALESCE("requiredStoragePoolId", "defaultStoragePoolId"),
  "requiredStorageType" = COALESCE("requiredStorageType", UPPER(NULLIF("storageType", '')));

CREATE INDEX IF NOT EXISTS "products_storagePolicyType_idx" ON "products"("storagePolicyType");
CREATE INDEX IF NOT EXISTS "products_requiredStoragePoolId_idx" ON "products"("requiredStoragePoolId");
