-- Production IPAM hierarchy, product pool controls, and analytics attribution.

ALTER TABLE "ip_pools" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'public';
ALTER TABLE "ip_pools" ADD COLUMN IF NOT EXISTS "pricePerIp" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "ip_pools" ADD COLUMN IF NOT EXISTS "bulkEnabled" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "ip_pools_type_idx" ON "ip_pools"("type");

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "premiumIpEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ip_allocations" ADD COLUMN IF NOT EXISTS "nodeId" TEXT;
ALTER TABLE "ip_allocations" ADD COLUMN IF NOT EXISTS "allocationType" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "ip_allocations_nodeId_idx" ON "ip_allocations"("nodeId");
CREATE INDEX IF NOT EXISTS "ip_allocations_allocationType_idx" ON "ip_allocations"("allocationType");

CREATE TABLE IF NOT EXISTS "node_ip_pools" (
  "id" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "poolId" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isPremiumDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "node_ip_pools_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "node_ip_pools_nodeId_poolId_key" ON "node_ip_pools"("nodeId", "poolId");
CREATE INDEX IF NOT EXISTS "node_ip_pools_nodeId_isDefault_idx" ON "node_ip_pools"("nodeId", "isDefault");
CREATE INDEX IF NOT EXISTS "node_ip_pools_nodeId_isPremiumDefault_idx" ON "node_ip_pools"("nodeId", "isPremiumDefault");
CREATE INDEX IF NOT EXISTS "node_ip_pools_poolId_idx" ON "node_ip_pools"("poolId");
CREATE UNIQUE INDEX IF NOT EXISTS "node_ip_pools_one_default_per_node_idx" ON "node_ip_pools"("nodeId") WHERE "isDefault" = true;
CREATE UNIQUE INDEX IF NOT EXISTS "node_ip_pools_one_premium_default_per_node_idx" ON "node_ip_pools"("nodeId") WHERE "isPremiumDefault" = true;

CREATE TABLE IF NOT EXISTS "product_ip_pools" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "poolId" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "allowPremium" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_ip_pools_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_ip_pools_productId_poolId_key" ON "product_ip_pools"("productId", "poolId");
CREATE INDEX IF NOT EXISTS "product_ip_pools_productId_isDefault_idx" ON "product_ip_pools"("productId", "isDefault");
CREATE INDEX IF NOT EXISTS "product_ip_pools_productId_allowPremium_idx" ON "product_ip_pools"("productId", "allowPremium");
CREATE INDEX IF NOT EXISTS "product_ip_pools_poolId_idx" ON "product_ip_pools"("poolId");
CREATE UNIQUE INDEX IF NOT EXISTS "product_ip_pools_one_default_per_product_idx" ON "product_ip_pools"("productId") WHERE "isDefault" = true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'node_ip_pools_nodeId_fkey') THEN
    ALTER TABLE "node_ip_pools" ADD CONSTRAINT "node_ip_pools_nodeId_fkey"
      FOREIGN KEY ("nodeId") REFERENCES "proxmox_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'node_ip_pools_poolId_fkey') THEN
    ALTER TABLE "node_ip_pools" ADD CONSTRAINT "node_ip_pools_poolId_fkey"
      FOREIGN KEY ("poolId") REFERENCES "ip_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_ip_pools_productId_fkey') THEN
    ALTER TABLE "product_ip_pools" ADD CONSTRAINT "product_ip_pools_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_ip_pools_poolId_fkey') THEN
    ALTER TABLE "product_ip_pools" ADD CONSTRAINT "product_ip_pools_poolId_fkey"
      FOREIGN KEY ("poolId") REFERENCES "ip_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ip_allocations_nodeId_fkey') THEN
    ALTER TABLE "ip_allocations" ADD CONSTRAINT "ip_allocations_nodeId_fkey"
      FOREIGN KEY ("nodeId") REFERENCES "proxmox_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "node_ip_pools" ("id", "nodeId", "poolId", "isDefault", "isPremiumDefault", "createdAt", "updatedAt")
SELECT
  'nodeip_' || substr(md5(n."id" || ':' || p."id"), 1, 24),
  n."id",
  p."id",
  false,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "proxmox_nodes" n
JOIN "ip_pools" p ON p."isActive" = true AND (p."proxmoxNodeId" = n."id" OR p."proxmoxNodeId" IS NULL)
ON CONFLICT ("nodeId", "poolId") DO NOTHING;

WITH ranked AS (
  SELECT
    nip."id",
    ROW_NUMBER() OVER (
      PARTITION BY nip."nodeId"
      ORDER BY
        CASE WHEN p."proxmoxNodeId" = nip."nodeId" THEN 0 ELSE 1 END,
        p."createdAt" ASC,
        p."id" ASC
    ) AS rn
  FROM "node_ip_pools" nip
  JOIN "ip_pools" p ON p."id" = nip."poolId"
  WHERE p."isActive" = true AND p."type" <> 'premium'
)
UPDATE "node_ip_pools" nip
SET "isDefault" = true, "updatedAt" = CURRENT_TIMESTAMP
FROM ranked
WHERE ranked."id" = nip."id" AND ranked.rn = 1
  AND NOT EXISTS (
    SELECT 1 FROM "node_ip_pools" existing
    WHERE existing."nodeId" = nip."nodeId" AND existing."isDefault" = true
  );

WITH ranked AS (
  SELECT
    nip."id",
    ROW_NUMBER() OVER (
      PARTITION BY nip."nodeId"
      ORDER BY p."createdAt" ASC, p."id" ASC
    ) AS rn
  FROM "node_ip_pools" nip
  JOIN "ip_pools" p ON p."id" = nip."poolId"
  WHERE p."isActive" = true AND p."type" = 'premium'
)
UPDATE "node_ip_pools" nip
SET "isPremiumDefault" = true, "updatedAt" = CURRENT_TIMESTAMP
FROM ranked
WHERE ranked."id" = nip."id" AND ranked.rn = 1
  AND NOT EXISTS (
    SELECT 1 FROM "node_ip_pools" existing
    WHERE existing."nodeId" = nip."nodeId" AND existing."isPremiumDefault" = true
  );

INSERT INTO "product_ip_pools" ("id", "productId", "poolId", "isDefault", "allowPremium", "createdAt", "updatedAt")
SELECT
  'prodip_' || substr(md5(pr."id" || ':' || p."id"), 1, 24),
  pr."id",
  p."id",
  false,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "products" pr
JOIN "ip_pools" p ON p."isActive" = true
WHERE pr."isActive" = true AND pr."status" = 'active' AND pr."category" = 'vps'
ON CONFLICT ("productId", "poolId") DO NOTHING;

WITH ranked AS (
  SELECT
    pip."id",
    ROW_NUMBER() OVER (
      PARTITION BY pip."productId"
      ORDER BY
        CASE WHEN p."type" = 'public' THEN 0 WHEN p."type" = 'private' THEN 1 ELSE 2 END,
        p."createdAt" ASC,
        p."id" ASC
    ) AS rn
  FROM "product_ip_pools" pip
  JOIN "ip_pools" p ON p."id" = pip."poolId"
  WHERE p."isActive" = true AND p."type" <> 'premium'
)
UPDATE "product_ip_pools" pip
SET "isDefault" = true, "updatedAt" = CURRENT_TIMESTAMP
FROM ranked
WHERE ranked."id" = pip."id" AND ranked.rn = 1
  AND NOT EXISTS (
    SELECT 1 FROM "product_ip_pools" existing
    WHERE existing."productId" = pip."productId" AND existing."isDefault" = true
  );

UPDATE "ip_allocations" a
SET "nodeId" = COALESCE(
      (SELECT v."proxmoxNodeId" FROM "vps_instances" v WHERE v."id" = a."vpsInstanceId"),
      p."proxmoxNodeId"
    ),
    "allocationType" = CASE WHEN p."type" = 'premium' THEN 'premium' ELSE 'default' END
FROM "ip_pools" p
WHERE p."id" = a."poolId"
  AND (a."nodeId" IS NULL OR a."allocationType" IS NULL OR a."allocationType" = '');

ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "utmSource" TEXT;
ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "utmMedium" TEXT;
ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "trafficSource" TEXT;
CREATE INDEX IF NOT EXISTS "analytics_events_utmSource_idx" ON "analytics_events"("utmSource");
CREATE INDEX IF NOT EXISTS "analytics_events_trafficSource_createdAt_idx" ON "analytics_events"("trafficSource", "createdAt");
