ALTER TABLE `os_templates`
  ADD COLUMN `proxmoxNodeId` VARCHAR(191) NULL,
  ADD COLUMN `proxmoxStorage` VARCHAR(191) NULL,
  ADD COLUMN `proxmoxVolumeId` VARCHAR(191) NULL,
  ADD COLUMN `format` VARCHAR(191) NULL,
  ADD COLUMN `size` BIGINT NULL,
  ADD COLUMN `syncedFromProxmox` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `lastSyncedAt` DATETIME(3) NULL,
  ADD COLUMN `source` VARCHAR(191) NULL DEFAULT 'MANUAL';

CREATE UNIQUE INDEX `os_templates_proxmoxNodeId_proxmoxStorage_proxmoxVolumeId_key`
  ON `os_templates`(`proxmoxNodeId`, `proxmoxStorage`, `proxmoxVolumeId`);

CREATE INDEX `os_templates_proxmoxNodeId_idx` ON `os_templates`(`proxmoxNodeId`);

ALTER TABLE `os_templates`
  ADD CONSTRAINT `os_templates_proxmoxNodeId_fkey`
  FOREIGN KEY (`proxmoxNodeId`) REFERENCES `proxmox_nodes`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
