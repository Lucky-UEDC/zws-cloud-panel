-- Canonical VM/IP ownership rules.
-- Hostname is display metadata only; ownership is keyed by VPS/order/VMID plus vm_ip_assignments.

UPDATE ip_allocations
SET
  "vpsInstanceId" = NULL,
  vmid = NULL,
  hostname = NULL,
  "allocationLockKey" = NULL,
  "assignedBy" = NULL,
  "releasedAt" = COALESCE("releasedAt", now())
WHERE lower(status) IN ('free', 'released')
  AND (
    "vpsInstanceId" IS NOT NULL
    OR vmid IS NOT NULL
    OR hostname IS NOT NULL
    OR "allocationLockKey" IS NOT NULL
    OR "assignedBy" IS NOT NULL
  );

WITH ghost AS (
  SELECT a.id
  FROM vm_ip_assignments a
  LEFT JOIN vps_instances v ON v.id = a."vpsInstanceId"
  WHERE lower(a.status) = 'active'
    AND (v.id IS NULL OR v."deletedAt" IS NOT NULL)
)
UPDATE vm_ip_assignments a
SET
  status = 'released',
  "isPrimary" = false,
  role = CASE WHEN role = 'primary' THEN 'secondary' ELSE role END,
  "detachedAt" = COALESCE("detachedAt", now()),
  metadata = COALESCE(a.metadata, '{}'::jsonb) || jsonb_build_object('releasedBy', 'migration:ip_ownership_evolution_integrity', 'releasedAt', now())
FROM ghost
WHERE a.id = ghost.id;

WITH ranked_primary AS (
  SELECT
    a.id,
    row_number() OVER (
      PARTITION BY a."vpsInstanceId"
      ORDER BY
        CASE WHEN v."ipAddress" IS NOT NULL AND a."ipAddress" = v."ipAddress" THEN 0 ELSE 1 END,
        CASE WHEN a.role = 'primary' THEN 0 ELSE 1 END,
        a."createdAt" ASC
    ) AS rn
  FROM vm_ip_assignments a
  JOIN vps_instances v ON v.id = a."vpsInstanceId"
  WHERE lower(a.status) = 'active'
    AND a.family = 'ipv4'
    AND (a."isPrimary" = true OR a.role = 'primary')
    AND v."deletedAt" IS NULL
)
UPDATE vm_ip_assignments a
SET
  "isPrimary" = false,
  role = 'secondary',
  metadata = COALESCE(a.metadata, '{}'::jsonb) || jsonb_build_object('demotedBy', 'migration:ip_ownership_evolution_integrity', 'demotedAt', now())
FROM ranked_primary
WHERE a.id = ranked_primary.id
  AND ranked_primary.rn > 1;

WITH ranked_ip AS (
  SELECT
    a.id,
    row_number() OVER (
      PARTITION BY a."ipAddress"
      ORDER BY
        CASE WHEN v."ipAddress" = a."ipAddress" THEN 0 ELSE 1 END,
        CASE WHEN a."isPrimary" = true OR a.role = 'primary' THEN 0 ELSE 1 END,
        a."createdAt" ASC
    ) AS rn
  FROM vm_ip_assignments a
  JOIN vps_instances v ON v.id = a."vpsInstanceId"
  WHERE lower(a.status) = 'active'
    AND a.family = 'ipv4'
    AND a."ipAddress" IS NOT NULL
    AND v."deletedAt" IS NULL
)
UPDATE vm_ip_assignments a
SET
  status = 'released',
  "isPrimary" = false,
  role = CASE WHEN role = 'primary' THEN 'secondary' ELSE role END,
  "detachedAt" = COALESCE("detachedAt", now()),
  metadata = COALESCE(a.metadata, '{}'::jsonb) || jsonb_build_object('releasedBy', 'migration:ip_ownership_evolution_integrity_duplicate_ip', 'releasedAt', now())
FROM ranked_ip
WHERE a.id = ranked_ip.id
  AND ranked_ip.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS vm_ip_assignments_one_active_primary_ipv4_per_vm
  ON vm_ip_assignments ("vpsInstanceId")
  WHERE lower(status) = 'active'
    AND family = 'ipv4'
    AND ("isPrimary" = true OR role = 'primary');

CREATE UNIQUE INDEX IF NOT EXISTS vm_ip_assignments_one_active_ipv4_owner_per_ip
  ON vm_ip_assignments ("ipAddress")
  WHERE lower(status) = 'active'
    AND family = 'ipv4'
    AND "ipAddress" IS NOT NULL;
