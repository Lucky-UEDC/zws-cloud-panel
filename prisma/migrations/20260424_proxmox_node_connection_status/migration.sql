ALTER TABLE `proxmox_nodes`
  ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'unknown',
  ADD COLUMN `lastCheckedAt` DATETIME(3) NULL,
  ADD COLUMN `allowInsecureTls` BOOLEAN NOT NULL DEFAULT false;
