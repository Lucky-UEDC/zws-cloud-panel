-- Remove app lifecycle archive state and node OS routing restrictions.
-- Products that were previously archived become deleted/hidden so they remain
-- out of public/admin active calculations without preserving an archive state.

UPDATE "products"
SET
  "deletedAt" = COALESCE("deletedAt", NOW()),
  "status" = 'deleted',
  "isActive" = false,
  "visibility" = 'hidden'
WHERE "archived" = true
   OR lower(COALESCE("status", '')) = 'archived';

UPDATE "orders"
SET
  "deletedAt" = COALESCE("deletedAt", NOW()),
  "status" = 'DELETED',
  "isActive" = false
WHERE lower(COALESCE("status", '')) = 'archived';

UPDATE "vps_instances"
SET
  "deletedAt" = COALESCE("deletedAt", NOW()),
  "status" = 'DELETED'
WHERE lower(COALESCE("status", '')) = 'archived';

ALTER TABLE "products" DROP COLUMN IF EXISTS "archived";
ALTER TABLE "products" DROP COLUMN IF EXISTS "archivedAt";

DROP INDEX IF EXISTS "products_archived_idx";
DROP INDEX IF EXISTS "products_archivedAt_idx";

ALTER TABLE "proxmox_nodes" DROP COLUMN IF EXISTS "provisioningMode";
ALTER TABLE "proxmox_nodes" DROP COLUMN IF EXISTS "supported_os_types";
ALTER TABLE "node_capabilities" DROP COLUMN IF EXISTS "supported_os_types";
ALTER TABLE "plan_sync_runs" DROP COLUMN IF EXISTS "archived";

DROP INDEX IF EXISTS "proxmox_nodes_provisioningMode_isActive_idx";
DROP INDEX IF EXISTS "proxmox_nodes_supported_os_types_isActive_idx";
DROP INDEX IF EXISTS "node_capabilities_supported_os_types_idx";

DROP TYPE IF EXISTS "NodeProvisioningMode";
