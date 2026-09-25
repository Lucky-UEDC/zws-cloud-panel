-- Enterprise IPAM static networking canonical assignment tables and policy fields.

ALTER TABLE "ip_pools"
  ADD COLUMN IF NOT EXISTS "region" TEXT,
  ADD COLUMN IF NOT EXISTS "allocationPriority" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS "staticOnly" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "failoverPoolIds" JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS "pool_node_assignments" (
  "id" TEXT NOT NULL,
  "poolId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pool_node_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pool_product_assignments" (
  "id" TEXT NOT NULL,
  "poolId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pool_product_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pool_node_assignments_poolId_nodeId_key" ON "pool_node_assignments"("poolId", "nodeId");
CREATE INDEX IF NOT EXISTS "pool_node_assignments_nodeId_active_priority_idx" ON "pool_node_assignments"("nodeId", "active", "priority");
CREATE INDEX IF NOT EXISTS "pool_node_assignments_poolId_active_priority_idx" ON "pool_node_assignments"("poolId", "active", "priority");

CREATE UNIQUE INDEX IF NOT EXISTS "pool_product_assignments_poolId_productId_key" ON "pool_product_assignments"("poolId", "productId");
CREATE INDEX IF NOT EXISTS "pool_product_assignments_productId_active_priority_idx" ON "pool_product_assignments"("productId", "active", "priority");
CREATE INDEX IF NOT EXISTS "pool_product_assignments_poolId_active_priority_idx" ON "pool_product_assignments"("poolId", "active", "priority");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pool_node_assignments_poolId_fkey') THEN
    ALTER TABLE "pool_node_assignments"
      ADD CONSTRAINT "pool_node_assignments_poolId_fkey"
      FOREIGN KEY ("poolId") REFERENCES "ip_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pool_node_assignments_nodeId_fkey') THEN
    ALTER TABLE "pool_node_assignments"
      ADD CONSTRAINT "pool_node_assignments_nodeId_fkey"
      FOREIGN KEY ("nodeId") REFERENCES "proxmox_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pool_product_assignments_poolId_fkey') THEN
    ALTER TABLE "pool_product_assignments"
      ADD CONSTRAINT "pool_product_assignments_poolId_fkey"
      FOREIGN KEY ("poolId") REFERENCES "ip_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pool_product_assignments_productId_fkey') THEN
    ALTER TABLE "pool_product_assignments"
      ADD CONSTRAINT "pool_product_assignments_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill from previous assignment tables.
INSERT INTO "pool_node_assignments" ("id", "poolId", "nodeId", "priority", "active", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || n."poolId" || n."nodeId"),
  n."poolId",
  n."nodeId",
  CASE WHEN COALESCE(n."isDefault", false) THEN 1 WHEN COALESCE(n."isPremiumDefault", false) THEN 5 ELSE 100 END,
  true,
  COALESCE(n."createdAt", CURRENT_TIMESTAMP),
  COALESCE(n."updatedAt", CURRENT_TIMESTAMP)
FROM "node_ip_pools" n
ON CONFLICT ("poolId", "nodeId") DO UPDATE SET
  "priority" = LEAST("pool_node_assignments"."priority", EXCLUDED."priority"),
  "active" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "pool_product_assignments" ("id", "poolId", "productId", "priority", "active", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || p."poolId" || p."productId"),
  p."poolId",
  p."productId",
  CASE WHEN COALESCE(p."isDefault", false) THEN 1 WHEN COALESCE(p."allowPremium", false) THEN 5 ELSE 100 END,
  true,
  COALESCE(p."createdAt", CURRENT_TIMESTAMP),
  COALESCE(p."updatedAt", CURRENT_TIMESTAMP)
FROM "product_ip_pools" p
ON CONFLICT ("poolId", "productId") DO UPDATE SET
  "priority" = LEAST("pool_product_assignments"."priority", EXCLUDED."priority"),
  "active" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

-- Preserve region compatibility where regionTag existed.
UPDATE "ip_pools"
SET "region" = COALESCE(NULLIF("region", ''), NULLIF("regionTag", ''))
WHERE ("region" IS NULL OR "region" = '')
  AND ("regionTag" IS NOT NULL AND "regionTag" <> '');
