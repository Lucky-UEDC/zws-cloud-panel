ALTER TABLE "proxmox_nodes"
  ADD COLUMN IF NOT EXISTS "resolvedIp" TEXT;
