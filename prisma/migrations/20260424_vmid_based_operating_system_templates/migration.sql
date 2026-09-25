ALTER TABLE `os_templates`
  ADD COLUMN `proxmoxVmid` INT NULL,
  ADD COLUMN `proxmoxTemplateName` VARCHAR(191) NULL,
  ADD COLUMN `proxmoxStatus` VARCHAR(191) NULL,
  ADD COLUMN `cpu` INT NULL,
  ADD COLUMN `memoryMb` INT NULL,
  ADD COLUMN `diskGb` DOUBLE NULL,
  ADD COLUMN `proxmoxConfig` JSON NULL;

CREATE UNIQUE INDEX `os_templates_proxmoxNodeId_proxmoxVmid_key`
  ON `os_templates`(`proxmoxNodeId`, `proxmoxVmid`);
