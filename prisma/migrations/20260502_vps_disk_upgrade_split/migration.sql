-- Add explicit order classification for instance and disk upgrade orders.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "orderType" TEXT;
CREATE INDEX IF NOT EXISTS "orders_orderType_idx" ON "orders"("orderType");

-- Track per-VPS disks so resize, migration, and add-disk operations can be audited and provisioned independently.
CREATE TABLE IF NOT EXISTS "vps_disks" (
  "id" TEXT NOT NULL,
  "vpsId" TEXT NOT NULL,
  "proxmoxDiskKey" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "sizeGb" INTEGER NOT NULL,
  "storagePoolId" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vps_disks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "vps_disks_vpsId_proxmoxDiskKey_key" ON "vps_disks"("vpsId", "proxmoxDiskKey");
CREATE UNIQUE INDEX IF NOT EXISTS "vps_disks_vpsId_displayName_key" ON "vps_disks"("vpsId", "displayName");
CREATE INDEX IF NOT EXISTS "vps_disks_vpsId_status_idx" ON "vps_disks"("vpsId", "status");
CREATE INDEX IF NOT EXISTS "vps_disks_storagePoolId_idx" ON "vps_disks"("storagePoolId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vps_disks_vpsId_fkey'
  ) THEN
    ALTER TABLE "vps_disks"
      ADD CONSTRAINT "vps_disks_vpsId_fkey"
      FOREIGN KEY ("vpsId") REFERENCES "vps_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vps_disks_storagePoolId_fkey'
  ) THEN
    ALTER TABLE "vps_disks"
      ADD CONSTRAINT "vps_disks_storagePoolId_fkey"
      FOREIGN KEY ("storagePoolId") REFERENCES "node_storage_pool_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill one primary disk from the legacy VPS-level disk fields.
INSERT INTO "vps_disks" ("id", "vpsId", "proxmoxDiskKey", "displayName", "sizeGb", "storagePoolId", "isPrimary", "status", "metadata", "createdAt", "updatedAt")
SELECT
  'vdisk_' || replace(v."id", '-', ''),
  v."id",
  'scsi0',
  'disk1',
  GREATEST(1, COALESCE(v."diskGb", p."storageGb", 1)),
  v."storagePoolId",
  true,
  CASE WHEN v."deletedAt" IS NULL THEN 'ACTIVE' ELSE 'DELETED' END,
  jsonb_build_object('source', 'migration_backfill'),
  NOW(),
  NOW()
FROM "vps_instances" v
LEFT JOIN "products" p ON p."id" = v."productId"
WHERE NOT EXISTS (
  SELECT 1 FROM "vps_disks" d WHERE d."vpsId" = v."id" AND d."proxmoxDiskKey" = 'scsi0'
);
