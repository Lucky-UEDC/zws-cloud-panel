ALTER TABLE "vps_instances"
  ADD COLUMN IF NOT EXISTS "provisionMode" TEXT NOT NULL DEFAULT 'created';

CREATE INDEX IF NOT EXISTS "vps_instances_provisionMode_idx"
  ON "vps_instances"("provisionMode");

CREATE UNIQUE INDEX IF NOT EXISTS "vps_instances_active_node_vmid_unique"
  ON "vps_instances"("proxmoxNodeId", "vmid")
  WHERE "deletedAt" IS NULL
    AND "proxmoxNodeId" IS NOT NULL
    AND "vmid" > 0;
