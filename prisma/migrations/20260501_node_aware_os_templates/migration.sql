-- Make OS image selection node-aware while preserving the existing os_templates table.

DROP INDEX IF EXISTS "os_templates_slug_key";

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "requestedOsFamily" TEXT,
  ADD COLUMN IF NOT EXISTS "requestedOsVersion" TEXT;

ALTER TABLE "provisioning_jobs"
  ADD COLUMN IF NOT EXISTS "selectedTemplateId" TEXT,
  ADD COLUMN IF NOT EXISTS "requestedOsFamily" TEXT,
  ADD COLUMN IF NOT EXISTS "requestedOsVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "progress" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "errorCode" TEXT,
  ADD COLUMN IF NOT EXISTS "nextRetryAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "orders_requestedOsFamily_requestedOsVersion_idx"
  ON "orders"("requestedOsFamily", "requestedOsVersion");

CREATE INDEX IF NOT EXISTS "provisioning_jobs_proxmoxNodeId_idx"
  ON "provisioning_jobs"("proxmoxNodeId");

CREATE INDEX IF NOT EXISTS "provisioning_jobs_selectedTemplateId_idx"
  ON "provisioning_jobs"("selectedTemplateId");

CREATE INDEX IF NOT EXISTS "provisioning_jobs_requestedOsFamily_requestedOsVersion_idx"
  ON "provisioning_jobs"("requestedOsFamily", "requestedOsVersion");

CREATE INDEX IF NOT EXISTS "os_templates_proxmoxNodeId_slug_idx"
  ON "os_templates"("proxmoxNodeId", "slug");

CREATE INDEX IF NOT EXISTS "os_templates_osFamily_osVersion_isActive_idx"
  ON "os_templates"("osFamily", "osVersion", "isActive");
