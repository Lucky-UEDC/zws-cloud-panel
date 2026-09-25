ALTER TABLE "os_templates"
  ADD COLUMN IF NOT EXISTS "sourceType" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceVmid" INTEGER,
  ADD COLUMN IF NOT EXISTS "storage" TEXT,
  ADD COLUMN IF NOT EXISTS "osFamily" TEXT,
  ADD COLUMN IF NOT EXISTS "cloudInitSupported" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "reinstallEnabled" BOOLEAN NOT NULL DEFAULT true;

UPDATE "os_templates"
SET
  "sourceType" = COALESCE("sourceType", CASE WHEN "source" = 'PROXMOX' THEN 'TEMPLATE_VM' WHEN "format" = 'iso' THEN 'ISO' ELSE 'MANUAL' END),
  "sourceVmid" = COALESCE("sourceVmid", "proxmoxVmid"),
  "storage" = COALESCE("storage", "proxmoxStorage"),
  "osFamily" = COALESCE("osFamily", "category"),
  "cloudInitSupported" = COALESCE("cloudInitSupported", CASE WHEN "source" = 'PROXMOX' AND "proxmoxVmid" IS NOT NULL THEN true ELSE false END);
