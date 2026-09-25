-- Repair supported_os_types after the HYBRID default has been introduced.
-- The column default can fill before old provisioningMode values are copied,
-- so make the canonical capability match the existing node mode explicitly.

UPDATE "proxmox_nodes"
SET "supported_os_types" = CASE
  WHEN "provisioningMode" = 'WINDOWS_ONLY' THEN 'WINDOWS_ONLY'::"NodeProvisioningMode"
  WHEN "provisioningMode" = 'LINUX_ONLY' THEN 'LINUX_ONLY'::"NodeProvisioningMode"
  ELSE 'HYBRID'::"NodeProvisioningMode"
END;

UPDATE "node_capabilities" AS nc
SET "supported_os_types" = CASE
  WHEN n."provisioningMode" = 'WINDOWS_ONLY' THEN 'WINDOWS_ONLY'::"NodeProvisioningMode"
  WHEN n."provisioningMode" = 'LINUX_ONLY' THEN 'LINUX_ONLY'::"NodeProvisioningMode"
  ELSE 'HYBRID'::"NodeProvisioningMode"
END,
"updated_at" = NOW()
FROM "proxmox_nodes" AS n
WHERE nc."node_id" = n."id";
