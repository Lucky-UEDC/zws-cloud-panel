-- Enterprise VM network orchestration, multi-IP assignments, and timeline events.

ALTER TABLE "ip_pools" ADD COLUMN IF NOT EXISTS "reservedRanges" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "ip_pools" ADD COLUMN IF NOT EXISTS "floatingRanges" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "ip_pools" ADD COLUMN IF NOT EXISTS "failoverRanges" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "ip_pools" ADD COLUMN IF NOT EXISTS "vlanTag" INTEGER;
ALTER TABLE "ip_pools" ADD COLUMN IF NOT EXISTS "bridgeOverride" TEXT;
ALTER TABLE "ip_pools" ADD COLUMN IF NOT EXISTS "regionTag" TEXT;
ALTER TABLE "ip_pools" ADD COLUMN IF NOT EXISTS "healthStatus" TEXT NOT NULL DEFAULT 'healthy';
ALTER TABLE "ip_pools" ADD COLUMN IF NOT EXISTS "exhaustionDetected" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ip_pools" ADD COLUMN IF NOT EXISTS "duplicateIpsDetected" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "ip_pool_ranges" (
  "id" TEXT NOT NULL,
  "poolId" TEXT NOT NULL,
  "family" TEXT NOT NULL DEFAULT 'ipv4',
  "rangeType" TEXT NOT NULL DEFAULT 'address',
  "startAddress" TEXT,
  "endAddress" TEXT,
  "prefix" TEXT,
  "prefixLength" INTEGER,
  "role" TEXT NOT NULL DEFAULT 'general',
  "isReserved" BOOLEAN NOT NULL DEFAULT false,
  "isFloating" BOOLEAN NOT NULL DEFAULT false,
  "isFailover" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ip_pool_ranges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ip_pool_ranges_poolId_family_rangeType_idx" ON "ip_pool_ranges"("poolId", "family", "rangeType");
CREATE INDEX IF NOT EXISTS "ip_pool_ranges_poolId_role_isActive_idx" ON "ip_pool_ranges"("poolId", "role", "isActive");

CREATE TABLE IF NOT EXISTS "vm_network_interfaces" (
  "id" TEXT NOT NULL,
  "vpsInstanceId" TEXT NOT NULL,
  "proxmoxNodeId" TEXT,
  "vmid" INTEGER,
  "name" TEXT NOT NULL DEFAULT 'net0',
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "macAddress" TEXT,
  "bridge" TEXT,
  "vlanTag" INTEGER,
  "model" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vm_network_interfaces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "vm_network_interfaces_vpsInstanceId_name_key" ON "vm_network_interfaces"("vpsInstanceId", "name");
CREATE INDEX IF NOT EXISTS "vm_network_interfaces_vpsInstanceId_isPrimary_idx" ON "vm_network_interfaces"("vpsInstanceId", "isPrimary");
CREATE INDEX IF NOT EXISTS "vm_network_interfaces_proxmoxNodeId_vmid_idx" ON "vm_network_interfaces"("proxmoxNodeId", "vmid");

CREATE TABLE IF NOT EXISTS "vm_ip_assignments" (
  "id" TEXT NOT NULL,
  "vpsInstanceId" TEXT NOT NULL,
  "proxmoxNodeId" TEXT,
  "vmid" INTEGER,
  "poolId" TEXT,
  "interfaceId" TEXT,
  "ipAllocationId" TEXT,
  "family" TEXT NOT NULL DEFAULT 'ipv4',
  "assignmentType" TEXT NOT NULL DEFAULT 'address',
  "role" TEXT NOT NULL DEFAULT 'secondary',
  "ipAddress" TEXT,
  "cidr" INTEGER,
  "prefix" TEXT,
  "prefixLength" INTEGER,
  "gateway" TEXT,
  "bridge" TEXT,
  "vlanTag" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'active',
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "sourceAssignmentId" TEXT,
  "movedFromVpsId" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "attachedAt" TIMESTAMP(3),
  "detachedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vm_ip_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "vm_ip_assignments_vpsInstanceId_status_idx" ON "vm_ip_assignments"("vpsInstanceId", "status");
CREATE INDEX IF NOT EXISTS "vm_ip_assignments_vpsInstanceId_role_isPrimary_idx" ON "vm_ip_assignments"("vpsInstanceId", "role", "isPrimary");
CREATE INDEX IF NOT EXISTS "vm_ip_assignments_poolId_status_idx" ON "vm_ip_assignments"("poolId", "status");
CREATE INDEX IF NOT EXISTS "vm_ip_assignments_ipAddress_status_idx" ON "vm_ip_assignments"("ipAddress", "status");
CREATE INDEX IF NOT EXISTS "vm_ip_assignments_prefix_prefixLength_status_idx" ON "vm_ip_assignments"("prefix", "prefixLength", "status");
CREATE INDEX IF NOT EXISTS "vm_ip_assignments_ipAllocationId_idx" ON "vm_ip_assignments"("ipAllocationId");

CREATE TABLE IF NOT EXISTS "vm_network_events" (
  "id" TEXT NOT NULL,
  "vpsInstanceId" TEXT NOT NULL,
  "proxmoxNodeId" TEXT,
  "vmid" INTEGER,
  "eventType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'completed',
  "stage" TEXT,
  "riskClass" TEXT,
  "reason" TEXT,
  "actorEmail" TEXT,
  "oldState" JSONB NOT NULL DEFAULT '{}',
  "newState" JSONB NOT NULL DEFAULT '{}',
  "plan" JSONB NOT NULL DEFAULT '{}',
  "result" JSONB NOT NULL DEFAULT '{}',
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vm_network_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "vm_network_events_vpsInstanceId_createdAt_idx" ON "vm_network_events"("vpsInstanceId", "createdAt");
CREATE INDEX IF NOT EXISTS "vm_network_events_eventType_createdAt_idx" ON "vm_network_events"("eventType", "createdAt");
CREATE INDEX IF NOT EXISTS "vm_network_events_status_createdAt_idx" ON "vm_network_events"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "vm_network_events_proxmoxNodeId_vmid_createdAt_idx" ON "vm_network_events"("proxmoxNodeId", "vmid", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ip_pool_ranges_poolId_fkey') THEN
    ALTER TABLE "ip_pool_ranges" ADD CONSTRAINT "ip_pool_ranges_poolId_fkey"
      FOREIGN KEY ("poolId") REFERENCES "ip_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vm_network_interfaces_vpsInstanceId_fkey') THEN
    ALTER TABLE "vm_network_interfaces" ADD CONSTRAINT "vm_network_interfaces_vpsInstanceId_fkey"
      FOREIGN KEY ("vpsInstanceId") REFERENCES "vps_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vm_network_interfaces_proxmoxNodeId_fkey') THEN
    ALTER TABLE "vm_network_interfaces" ADD CONSTRAINT "vm_network_interfaces_proxmoxNodeId_fkey"
      FOREIGN KEY ("proxmoxNodeId") REFERENCES "proxmox_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vm_ip_assignments_vpsInstanceId_fkey') THEN
    ALTER TABLE "vm_ip_assignments" ADD CONSTRAINT "vm_ip_assignments_vpsInstanceId_fkey"
      FOREIGN KEY ("vpsInstanceId") REFERENCES "vps_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vm_ip_assignments_proxmoxNodeId_fkey') THEN
    ALTER TABLE "vm_ip_assignments" ADD CONSTRAINT "vm_ip_assignments_proxmoxNodeId_fkey"
      FOREIGN KEY ("proxmoxNodeId") REFERENCES "proxmox_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vm_ip_assignments_poolId_fkey') THEN
    ALTER TABLE "vm_ip_assignments" ADD CONSTRAINT "vm_ip_assignments_poolId_fkey"
      FOREIGN KEY ("poolId") REFERENCES "ip_pools"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vm_ip_assignments_interfaceId_fkey') THEN
    ALTER TABLE "vm_ip_assignments" ADD CONSTRAINT "vm_ip_assignments_interfaceId_fkey"
      FOREIGN KEY ("interfaceId") REFERENCES "vm_network_interfaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vm_network_events_vpsInstanceId_fkey') THEN
    ALTER TABLE "vm_network_events" ADD CONSTRAINT "vm_network_events_vpsInstanceId_fkey"
      FOREIGN KEY ("vpsInstanceId") REFERENCES "vps_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vm_network_events_proxmoxNodeId_fkey') THEN
    ALTER TABLE "vm_network_events" ADD CONSTRAINT "vm_network_events_proxmoxNodeId_fkey"
      FOREIGN KEY ("proxmoxNodeId") REFERENCES "proxmox_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill default net0 interfaces for existing VPS rows.
INSERT INTO "vm_network_interfaces" (
  "id", "vpsInstanceId", "proxmoxNodeId", "vmid", "name", "isPrimary", "createdAt", "updatedAt"
)
SELECT
  'vmnif_' || substr(md5(v."id" || ':net0'), 1, 24),
  v."id",
  v."proxmoxNodeId",
  v."vmid",
  'net0',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "vps_instances" v
WHERE v."deletedAt" IS NULL
ON CONFLICT ("vpsInstanceId", "name") DO NOTHING;

-- Backfill active primary assignment from legacy ip_allocations.
INSERT INTO "vm_ip_assignments" (
  "id", "vpsInstanceId", "proxmoxNodeId", "vmid", "poolId", "interfaceId", "ipAllocationId", "family", "assignmentType", "role", "ipAddress", "cidr", "gateway", "bridge", "status", "isPrimary", "attachedAt", "metadata", "createdAt", "updatedAt"
)
SELECT
  'vmipa_' || substr(md5(a."id" || ':primary'), 1, 24),
  a."vpsInstanceId",
  COALESCE(a."nodeId", v."proxmoxNodeId"),
  COALESCE(a."vmid", v."vmid"),
  a."poolId",
  ni."id",
  a."id",
  'ipv4',
  'address',
  'primary',
  a."ipAddress",
  p."cidr",
  p."gateway",
  COALESCE(p."bridgeOverride", p."bridge"),
  CASE WHEN lower(a."status") IN ('released', 'free') THEN 'released' ELSE 'active' END,
  true,
  a."createdAt",
  jsonb_build_object('legacyIpAllocationStatus', a."status", 'legacyAllocationType', a."allocationType"),
  a."createdAt",
  a."updatedAt"
FROM "ip_allocations" a
JOIN "vps_instances" v ON v."id" = a."vpsInstanceId"
LEFT JOIN "ip_pools" p ON p."id" = a."poolId"
LEFT JOIN "vm_network_interfaces" ni ON ni."vpsInstanceId" = v."id" AND ni."name" = 'net0'
WHERE a."vpsInstanceId" IS NOT NULL
  AND lower(a."status") IN ('reserved', 'used')
  AND a."ipAddress" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Sync pool-level exhaustion and duplicate flags from legacy allocations.
WITH stats AS (
  SELECT
    p."id" AS pool_id,
    COUNT(*) FILTER (WHERE lower(a."status") IN ('reserved','used')) AS active_count,
    COUNT(*) FILTER (WHERE lower(a."status") IN ('free','released')) AS free_count
  FROM "ip_pools" p
  LEFT JOIN "ip_allocations" a ON a."poolId" = p."id"
  GROUP BY p."id"
),
dupes AS (
  SELECT a."poolId" AS pool_id, COUNT(*) AS dup_count
  FROM "ip_allocations" a
  WHERE lower(a."status") IN ('reserved','used')
  GROUP BY a."poolId", a."ipAddress"
  HAVING COUNT(*) > 1
)
UPDATE "ip_pools" p
SET
  "exhaustionDetected" = COALESCE(s.free_count, 0) = 0 AND COALESCE(s.active_count, 0) > 0,
  "duplicateIpsDetected" = EXISTS (SELECT 1 FROM dupes d WHERE d.pool_id = p."id")
FROM stats s
WHERE s.pool_id = p."id";
