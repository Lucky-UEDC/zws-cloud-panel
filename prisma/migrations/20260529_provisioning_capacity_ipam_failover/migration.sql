-- Enterprise provisioning placement, IPAM pool modes, node OS routing, and failover metadata.

DO $$
BEGIN
  CREATE TYPE "IpPoolMode" AS ENUM ('GLOBAL', 'NODE_RESTRICTED', 'PRODUCT_RESTRICTED', 'HYBRID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "NodeProvisioningMode" AS ENUM ('ALL_OS', 'WINDOWS_ONLY', 'LINUX_ONLY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "ip_pools"
  ADD COLUMN IF NOT EXISTS "poolMode" "IpPoolMode" NOT NULL DEFAULT 'NODE_RESTRICTED';

ALTER TABLE "proxmox_nodes"
  ADD COLUMN IF NOT EXISTS "provisioningMode" "NodeProvisioningMode" NOT NULL DEFAULT 'ALL_OS';

ALTER TABLE "provisioning_jobs"
  ADD COLUMN IF NOT EXISTS "failoverFromNodeId" TEXT,
  ADD COLUMN IF NOT EXISTS "failoverReason" TEXT;

UPDATE "ip_pools" pool
SET "poolMode" = CASE
  WHEN pool."appliesToAllNodes" = true AND pool."appliesToAllProducts" = true THEN 'GLOBAL'::"IpPoolMode"
  WHEN (
    pool."appliesToAllNodes" = false
    AND (
      pool."proxmoxNodeId" IS NOT NULL
      OR EXISTS (SELECT 1 FROM "pool_node_assignments" pna WHERE pna."poolId" = pool."id" AND pna."active" = true)
      OR EXISTS (SELECT 1 FROM "node_ip_pools" nip WHERE nip."poolId" = pool."id")
    )
  )
  AND (
    pool."appliesToAllProducts" = false
    AND (
      EXISTS (SELECT 1 FROM "pool_product_assignments" ppa WHERE ppa."poolId" = pool."id" AND ppa."active" = true)
      OR EXISTS (SELECT 1 FROM "product_ip_pools" pip WHERE pip."poolId" = pool."id")
    )
  ) THEN 'HYBRID'::"IpPoolMode"
  WHEN pool."appliesToAllProducts" = false
    AND (
      EXISTS (SELECT 1 FROM "pool_product_assignments" ppa WHERE ppa."poolId" = pool."id" AND ppa."active" = true)
      OR EXISTS (SELECT 1 FROM "product_ip_pools" pip WHERE pip."poolId" = pool."id")
    ) THEN 'PRODUCT_RESTRICTED'::"IpPoolMode"
  ELSE 'NODE_RESTRICTED'::"IpPoolMode"
END;

UPDATE "proxmox_nodes" node
SET "provisioningMode" = CASE
  WHEN EXISTS (
    SELECT 1 FROM "os_templates" template
    WHERE template."proxmoxNodeId" = node."id"
      AND template."isActive" = true
      AND (
        lower(coalesce(template."osFamily", '')) LIKE '%windows%'
        OR lower(coalesce(template."osType", '')) LIKE '%windows%'
        OR lower(coalesce(template."category", '')) LIKE '%windows%'
        OR lower(coalesce(template."name", '')) LIKE '%windows%'
        OR lower(coalesce(template."slug", '')) LIKE '%windows%'
      )
  ) THEN 'WINDOWS_ONLY'::"NodeProvisioningMode"
  WHEN EXISTS (
    SELECT 1 FROM "os_templates" template
    WHERE template."proxmoxNodeId" = node."id"
      AND template."isActive" = true
  ) THEN 'LINUX_ONLY'::"NodeProvisioningMode"
  ELSE 'ALL_OS'::"NodeProvisioningMode"
END
WHERE node."provisioningMode" = 'ALL_OS';

CREATE INDEX IF NOT EXISTS "ip_pools_poolMode_isActive_idx" ON "ip_pools"("poolMode", "isActive");
CREATE INDEX IF NOT EXISTS "proxmox_nodes_provisioningMode_isActive_idx" ON "proxmox_nodes"("provisioningMode", "isActive");
CREATE INDEX IF NOT EXISTS "provisioning_jobs_failoverFromNodeId_idx" ON "provisioning_jobs"("failoverFromNodeId");

CREATE INDEX IF NOT EXISTS "orders_status_createdAt_idx" ON "orders"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "orders_provisioningStatus_createdAt_idx" ON "orders"("provisioningStatus", "createdAt");
CREATE INDEX IF NOT EXISTS "orders_customerId_deletedAt_status_idx" ON "orders"("customerId", "deletedAt", "status");
CREATE INDEX IF NOT EXISTS "orders_proxmoxNodeId_provisioningStatus_idx" ON "orders"("proxmoxNodeId", "provisioningStatus");

CREATE INDEX IF NOT EXISTS "vps_instances_customerId_deletedAt_status_idx" ON "vps_instances"("customerId", "deletedAt", "status");
CREATE INDEX IF NOT EXISTS "vps_instances_proxmoxNodeId_deletedAt_status_idx" ON "vps_instances"("proxmoxNodeId", "deletedAt", "status");
CREATE INDEX IF NOT EXISTS "vps_instances_orderId_customerId_idx" ON "vps_instances"("orderId", "customerId");

CREATE INDEX IF NOT EXISTS "ip_allocations_ipAddress_status_idx" ON "ip_allocations"("ipAddress", "status");
CREATE INDEX IF NOT EXISTS "ip_allocations_poolId_status_ipAddress_idx" ON "ip_allocations"("poolId", "status", "ipAddress");
CREATE INDEX IF NOT EXISTS "ip_allocations_nodeId_status_idx" ON "ip_allocations"("nodeId", "status");

CREATE INDEX IF NOT EXISTS "node_metrics_nodeId_recordedAt_desc_idx" ON "node_metrics"("nodeId", "recordedAt" DESC);
CREATE INDEX IF NOT EXISTS "provisioning_jobs_status_type_nextRetryAt_idx" ON "provisioning_jobs"("status", "type", "nextRetryAt");
