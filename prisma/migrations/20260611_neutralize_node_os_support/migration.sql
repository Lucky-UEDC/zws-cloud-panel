UPDATE "proxmox_nodes"
SET "provisioningMode" = 'HYBRID',
    "supported_os_types" = 'HYBRID'
WHERE "provisioningMode" IS DISTINCT FROM 'HYBRID'
   OR "supported_os_types" IS DISTINCT FROM 'HYBRID';

DELETE FROM "node_capabilities";
DELETE FROM "template_capabilities";

UPDATE "system_settings"
SET "windows_only" = false,
    "linux_only" = false
WHERE "windows_only" = true OR "linux_only" = true;
