-- Offers, node classes, CPU topology, and storage-pool controls.

CREATE TABLE IF NOT EXISTS "node_classes" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "publicLabel" TEXT,
  "description" TEXT,
  "cpuModelMatch" TEXT,
  "cpuPricePerVcpuMonthly" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "ramPricePerGbMonthly" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "cpuPricingMultiplier" DECIMAL(8,4),
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "publicSelectable" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "node_classes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "node_classes_slug_key" ON "node_classes"("slug");
CREATE INDEX IF NOT EXISTS "node_classes_enabled_publicSelectable_sortOrder_idx" ON "node_classes"("enabled", "publicSelectable", "sortOrder");

CREATE TABLE IF NOT EXISTS "node_storage_pool_configs" (
  "id" TEXT NOT NULL,
  "proxmoxNodeId" TEXT NOT NULL,
  "storageId" TEXT NOT NULL,
  "displayName" TEXT,
  "type" TEXT,
  "totalBytes" BIGINT,
  "usedBytes" BIGINT,
  "freeBytes" BIGINT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "defaultForNewVm" BOOLEAN NOT NULL DEFAULT false,
  "premium" BOOLEAN NOT NULL DEFAULT false,
  "allowNewPurchase" BOOLEAN NOT NULL DEFAULT false,
  "allowUpgrade" BOOLEAN NOT NULL DEFAULT false,
  "pricePerGbMonthly" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "node_storage_pool_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "node_storage_pool_configs_proxmoxNodeId_storageId_key" ON "node_storage_pool_configs"("proxmoxNodeId", "storageId");
CREATE INDEX IF NOT EXISTS "node_storage_pool_configs_proxmoxNodeId_defaultForNewVm_idx" ON "node_storage_pool_configs"("proxmoxNodeId", "defaultForNewVm");
CREATE INDEX IF NOT EXISTS "node_storage_pool_configs_proxmoxNodeId_enabled_idx" ON "node_storage_pool_configs"("proxmoxNodeId", "enabled");

CREATE TABLE IF NOT EXISTS "offers" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "headline" TEXT,
  "description" TEXT,
  "planLabel" TEXT,
  "productId" TEXT,
  "vcpu" INTEGER NOT NULL,
  "ramGb" INTEGER NOT NULL,
  "storageGb" INTEGER NOT NULL,
  "bandwidthTb" DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  "storageTier" TEXT,
  "storagePoolPolicy" TEXT,
  "storagePoolId" TEXT,
  "cpuClass" TEXT,
  "nodeClassId" TEXT,
  "region" TEXT,
  "osTemplateId" TEXT,
  "defaultCpuSockets" INTEGER,
  "defaultCoresPerSocket" INTEGER,
  "baseMonthlyPrice" DECIMAL(10,2) NOT NULL,
  "offerMonthlyPrice" DECIMAL(10,2) NOT NULL,
  "gstEnabled" BOOLEAN NOT NULL DEFAULT true,
  "gstPercent" DECIMAL(5,2) NOT NULL DEFAULT 18.00,
  "billingTermsAllowed" JSONB NOT NULL DEFAULT '[1]',
  "defaultBillingTerm" INTEGER NOT NULL DEFAULT 1,
  "maxPurchases" INTEGER,
  "purchasesCount" INTEGER NOT NULL DEFAULT 0,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "featured" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "offers_slug_key" ON "offers"("slug");
CREATE INDEX IF NOT EXISTS "offers_active_startsAt_endsAt_idx" ON "offers"("active", "startsAt", "endsAt");
CREATE INDEX IF NOT EXISTS "offers_productId_idx" ON "offers"("productId");
CREATE INDEX IF NOT EXISTS "offers_nodeClassId_idx" ON "offers"("nodeClassId");
CREATE INDEX IF NOT EXISTS "offers_osTemplateId_idx" ON "offers"("osTemplateId");

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "defaultCpuSockets" INTEGER;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "defaultCoresPerSocket" INTEGER;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "nodeClassId" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "defaultStoragePoolId" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "storagePoolPolicy" TEXT;
CREATE INDEX IF NOT EXISTS "products_nodeClassId_idx" ON "products"("nodeClassId");

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "offerId" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "offerSnapshot" JSONB;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "nodeClassId" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "nodeClassSnapshot" JSONB;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "storagePoolId" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "storagePoolSnapshot" JSONB;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cpuSockets" INTEGER;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "coresPerSocket" INTEGER;
CREATE INDEX IF NOT EXISTS "orders_offerId_idx" ON "orders"("offerId");
CREATE INDEX IF NOT EXISTS "orders_nodeClassId_idx" ON "orders"("nodeClassId");
CREATE INDEX IF NOT EXISTS "orders_storagePoolId_idx" ON "orders"("storagePoolId");

ALTER TABLE "vps_instances" ADD COLUMN IF NOT EXISTS "nodeClassId" TEXT;
ALTER TABLE "vps_instances" ADD COLUMN IF NOT EXISTS "storagePoolId" TEXT;
ALTER TABLE "vps_instances" ADD COLUMN IF NOT EXISTS "storagePoolSnapshot" JSONB;
ALTER TABLE "vps_instances" ADD COLUMN IF NOT EXISTS "cpuSockets" INTEGER;
ALTER TABLE "vps_instances" ADD COLUMN IF NOT EXISTS "coresPerSocket" INTEGER;
CREATE INDEX IF NOT EXISTS "vps_instances_nodeClassId_idx" ON "vps_instances"("nodeClassId");
CREATE INDEX IF NOT EXISTS "vps_instances_storagePoolId_idx" ON "vps_instances"("storagePoolId");

ALTER TABLE "proxmox_nodes" ADD COLUMN IF NOT EXISTS "nodeClassId" TEXT;
ALTER TABLE "proxmox_nodes" ADD COLUMN IF NOT EXISTS "cpuSocketsDetected" INTEGER;
ALTER TABLE "proxmox_nodes" ADD COLUMN IF NOT EXISTS "defaultVmSockets" INTEGER;
ALTER TABLE "proxmox_nodes" ADD COLUMN IF NOT EXISTS "cpuModel" TEXT;
ALTER TABLE "proxmox_nodes" ADD COLUMN IF NOT EXISTS "cpuClass" TEXT;
ALTER TABLE "proxmox_nodes" ADD COLUMN IF NOT EXISTS "cpuPricingMultiplier" DECIMAL(8,4);
CREATE INDEX IF NOT EXISTS "proxmox_nodes_nodeClassId_idx" ON "proxmox_nodes"("nodeClassId");

ALTER TABLE "audit_logs" ALTER COLUMN "adminId" DROP NOT NULL;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "actorEmail" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "targetType" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "targetId" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "metadata" JSONB NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS "audit_logs_targetType_targetId_createdAt_idx" ON "audit_logs"("targetType", "targetId", "createdAt");

ALTER TABLE "node_storage_pool_configs"
  ADD CONSTRAINT "node_storage_pool_configs_proxmoxNodeId_fkey"
  FOREIGN KEY ("proxmoxNodeId") REFERENCES "proxmox_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "offers"
  ADD CONSTRAINT "offers_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "offers_nodeClassId_fkey" FOREIGN KEY ("nodeClassId") REFERENCES "node_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "offers_osTemplateId_fkey" FOREIGN KEY ("osTemplateId") REFERENCES "os_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "offers_storagePoolId_fkey" FOREIGN KEY ("storagePoolId") REFERENCES "node_storage_pool_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "products"
  ADD CONSTRAINT "products_nodeClassId_fkey" FOREIGN KEY ("nodeClassId") REFERENCES "node_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "orders_nodeClassId_fkey" FOREIGN KEY ("nodeClassId") REFERENCES "node_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "orders_storagePoolId_fkey" FOREIGN KEY ("storagePoolId") REFERENCES "node_storage_pool_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vps_instances"
  ADD CONSTRAINT "vps_instances_nodeClassId_fkey" FOREIGN KEY ("nodeClassId") REFERENCES "node_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "vps_instances_storagePoolId_fkey" FOREIGN KEY ("storagePoolId") REFERENCES "node_storage_pool_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "proxmox_nodes"
  ADD CONSTRAINT "proxmox_nodes_nodeClassId_fkey" FOREIGN KEY ("nodeClassId") REFERENCES "node_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "node_classes" ("id", "name", "slug", "publicLabel", "description", "enabled", "publicSelectable", "sortOrder", "metadata", "createdAt", "updatedAt")
VALUES ('standard-compute', 'Standard Compute', 'standard-compute', 'Standard Compute', 'Default compute class for existing products and nodes.', true, true, 0, '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

UPDATE "proxmox_nodes"
SET "defaultVmSockets" = COALESCE("defaultVmSockets", "cpuSocketsDetected", 1),
    "nodeClassId" = COALESCE("nodeClassId", 'standard-compute')
WHERE "nodeClassId" IS NULL OR "defaultVmSockets" IS NULL;
