-- AddColumn reinstall_lock to vps_instances
ALTER TABLE "vps_instances"
  ADD COLUMN IF NOT EXISTS "reinstall_lock" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "reinstall_locked_at" TIMESTAMP(3);

-- AddColumn ssh credentials to proxmox_nodes
ALTER TABLE "proxmox_nodes"
  ADD COLUMN IF NOT EXISTS "ssh_username" TEXT,
  ADD COLUMN IF NOT EXISTS "ssh_password" TEXT;

-- Index for fast lookup of locked VPS instances
CREATE INDEX IF NOT EXISTS "vps_instances_reinstall_lock_idx"
  ON "vps_instances"("reinstall_lock") WHERE "reinstall_lock" = true;
