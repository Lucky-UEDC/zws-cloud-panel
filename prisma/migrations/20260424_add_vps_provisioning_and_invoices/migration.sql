ALTER TABLE `orders`
  ADD COLUMN `operatingSystemId` VARCHAR(191) NULL,
  ADD COLUMN `osName` VARCHAR(191) NULL,
  ADD COLUMN `templateVmid` INT NULL,
  ADD COLUMN `proxmoxNodeId` VARCHAR(191) NULL,
  ADD COLUMN `provisioningStatus` VARCHAR(191) NOT NULL DEFAULT 'pending',
  ADD COLUMN `provisioningError` TEXT NULL,
  ADD COLUMN `provisionedAt` DATETIME(3) NULL,
  ADD COLUMN `serviceId` VARCHAR(191) NULL;

CREATE INDEX `orders_operatingSystemId_idx` ON `orders`(`operatingSystemId`);
CREATE INDEX `orders_proxmoxNodeId_idx` ON `orders`(`proxmoxNodeId`);
CREATE INDEX `orders_provisioningStatus_idx` ON `orders`(`provisioningStatus`);

CREATE UNIQUE INDEX `invoices_orderId_key` ON `invoices`(`orderId`);

CREATE TABLE `vps_instances` (
  `id` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `productId` VARCHAR(191) NULL,
  `proxmoxNodeId` VARCHAR(191) NULL,
  `operatingSystemId` VARCHAR(191) NULL,
  `vmid` INT NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'active',
  `ipAddress` VARCHAR(191) NULL,
  `username` VARCHAR(191) NULL,
  `passwordEncrypted` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `vps_instances_orderId_key`(`orderId`),
  INDEX `vps_instances_customerId_idx`(`customerId`),
  INDEX `vps_instances_productId_idx`(`productId`),
  INDEX `vps_instances_proxmoxNodeId_idx`(`proxmoxNodeId`),
  INDEX `vps_instances_operatingSystemId_idx`(`operatingSystemId`),
  INDEX `vps_instances_vmid_idx`(`vmid`),
  INDEX `vps_instances_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `orders`
  ADD CONSTRAINT `orders_operatingSystemId_fkey`
  FOREIGN KEY (`operatingSystemId`) REFERENCES `os_templates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `orders_proxmoxNodeId_fkey`
  FOREIGN KEY (`proxmoxNodeId`) REFERENCES `proxmox_nodes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `vps_instances`
  ADD CONSTRAINT `vps_instances_customerId_fkey`
  FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `vps_instances_orderId_fkey`
  FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `vps_instances_productId_fkey`
  FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `vps_instances_proxmoxNodeId_fkey`
  FOREIGN KEY (`proxmoxNodeId`) REFERENCES `proxmox_nodes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `vps_instances_operatingSystemId_fkey`
  FOREIGN KEY (`operatingSystemId`) REFERENCES `os_templates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
