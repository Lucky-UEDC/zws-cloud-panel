ALTER TABLE "vps_instances"
  ALTER COLUMN "vmid" SET DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "serviceProvider" TEXT,
  ADD COLUMN IF NOT EXISTS "externalVmId" TEXT,
  ADD COLUMN IF NOT EXISTS "serviceLocation" TEXT,
  ADD COLUMN IF NOT EXISTS "bandwidthTb" DECIMAL(10, 2);

CREATE INDEX IF NOT EXISTS "vps_instances_serviceProvider_externalVmId_idx"
  ON "vps_instances"("serviceProvider", "externalVmId");
