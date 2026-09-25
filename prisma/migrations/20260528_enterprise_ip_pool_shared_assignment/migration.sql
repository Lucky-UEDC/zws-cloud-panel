ALTER TABLE "ip_pools"
  ADD COLUMN IF NOT EXISTS "fallbackPriority" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS "appliesToAllNodes" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "appliesToAllProducts" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "ip_pools_appliesToAllNodes_appliesToAllProducts_idx"
  ON "ip_pools"("appliesToAllNodes", "appliesToAllProducts");

CREATE INDEX IF NOT EXISTS "ip_pools_fallbackPriority_idx"
  ON "ip_pools"("fallbackPriority");

UPDATE "ip_allocations"
SET "status" = 'assigned'
WHERE lower("status") = 'used';

UPDATE "ip_allocations"
SET "status" = 'reserved'
WHERE lower("status") = 'reserved';

UPDATE "ip_allocations"
SET "status" = 'free'
WHERE lower("status") IN ('free', 'released');

CREATE UNIQUE INDEX IF NOT EXISTS "ip_allocations_active_ip_address_key"
  ON "ip_allocations"("ipAddress")
  WHERE lower("status") IN ('reserved', 'assigned', 'used');
