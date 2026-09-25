ALTER TABLE `vps_instances`
  ADD COLUMN `cpuCores` INT NULL,
  ADD COLUMN `ramGb` INT NULL,
  ADD COLUMN `diskGb` INT NULL;

CREATE TABLE `ip_pools` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `proxmoxNodeId` VARCHAR(191) NULL,
  `startIp` VARCHAR(191) NOT NULL,
  `endIp` VARCHAR(191) NOT NULL,
  `gateway` VARCHAR(191) NOT NULL,
  `cidr` INT NOT NULL DEFAULT 24,
  `dns` VARCHAR(191) NOT NULL DEFAULT '1.1.1.1',
  `searchDomain` VARCHAR(191) NULL,
  `bridge` VARCHAR(191) NOT NULL DEFAULT 'vmbr0',
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `ip_pools_proxmoxNodeId_idx`(`proxmoxNodeId`),
  INDEX `ip_pools_isActive_idx`(`isActive`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ip_allocations` (
  `id` VARCHAR(191) NOT NULL,
  `poolId` VARCHAR(191) NOT NULL,
  `ipAddress` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'reserved',
  `vpsInstanceId` VARCHAR(191) NULL,
  `vmid` INT NULL,
  `hostname` VARCHAR(191) NULL,
  `assignedBy` VARCHAR(191) NULL,
  `releasedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `ip_allocations_poolId_ipAddress_key`(`poolId`, `ipAddress`),
  INDEX `ip_allocations_status_idx`(`status`),
  INDEX `ip_allocations_vpsInstanceId_idx`(`vpsInstanceId`),
  INDEX `ip_allocations_vmid_idx`(`vmid`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `provisioning_jobs` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NULL,
  `vpsInstanceId` VARCHAR(191) NULL,
  `customerId` VARCHAR(191) NULL,
  `type` VARCHAR(191) NOT NULL DEFAULT 'provision',
  `status` VARCHAR(191) NOT NULL DEFAULT 'queued',
  `displayStatus` VARCHAR(191) NOT NULL DEFAULT 'Queued',
  `currentStep` VARCHAR(191) NULL,
  `nodeName` VARCHAR(191) NULL,
  `proxmoxNodeId` VARCHAR(191) NULL,
  `vmid` INT NULL,
  `hostname` VARCHAR(191) NULL,
  `latestUpid` TEXT NULL,
  `attempts` INT NOT NULL DEFAULT 0,
  `maxAttempts` INT NOT NULL DEFAULT 3,
  `error` TEXT NULL,
  `metadata` JSON NOT NULL,
  `claimedAt` DATETIME(3) NULL,
  `startedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `provisioning_jobs_status_createdAt_idx`(`status`, `createdAt`),
  INDEX `provisioning_jobs_orderId_idx`(`orderId`),
  INDEX `provisioning_jobs_vpsInstanceId_idx`(`vpsInstanceId`),
  INDEX `provisioning_jobs_customerId_idx`(`customerId`),
  INDEX `provisioning_jobs_vmid_idx`(`vmid`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `provisioning_task_steps` (
  `id` VARCHAR(191) NOT NULL,
  `jobId` VARCHAR(191) NOT NULL,
  `step` VARCHAR(191) NOT NULL,
  `label` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
  `upid` TEXT NULL,
  `exitStatus` VARCHAR(191) NULL,
  `startedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `taskHistory` JSON NOT NULL,
  `error` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `provisioning_task_steps_jobId_step_key`(`jobId`, `step`),
  INDEX `provisioning_task_steps_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `provisioning_task_logs` (
  `id` VARCHAR(191) NOT NULL,
  `jobId` VARCHAR(191) NOT NULL,
  `step` VARCHAR(191) NULL,
  `level` VARCHAR(191) NOT NULL DEFAULT 'info',
  `event` VARCHAR(191) NOT NULL,
  `message` TEXT NOT NULL,
  `request` JSON NULL,
  `response` JSON NULL,
  `upid` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `provisioning_task_logs_jobId_createdAt_idx`(`jobId`, `createdAt`),
  INDEX `provisioning_task_logs_event_idx`(`event`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `vps_upgrade_requests` (
  `id` VARCHAR(191) NOT NULL,
  `vpsInstanceId` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'queued',
  `fromCpuCores` INT NULL,
  `toCpuCores` INT NULL,
  `fromRamGb` INT NULL,
  `toRamGb` INT NULL,
  `fromDiskGb` INT NULL,
  `toDiskGb` INT NULL,
  `error` TEXT NULL,
  `metadata` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `completedAt` DATETIME(3) NULL,

  INDEX `vps_upgrade_requests_vpsInstanceId_createdAt_idx`(`vpsInstanceId`, `createdAt`),
  INDEX `vps_upgrade_requests_customerId_createdAt_idx`(`customerId`, `createdAt`),
  INDEX `vps_upgrade_requests_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ip_pools`
  ADD CONSTRAINT `ip_pools_proxmoxNodeId_fkey`
  FOREIGN KEY (`proxmoxNodeId`) REFERENCES `proxmox_nodes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ip_allocations`
  ADD CONSTRAINT `ip_allocations_poolId_fkey`
  FOREIGN KEY (`poolId`) REFERENCES `ip_pools`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `ip_allocations_vpsInstanceId_fkey`
  FOREIGN KEY (`vpsInstanceId`) REFERENCES `vps_instances`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `provisioning_jobs`
  ADD CONSTRAINT `provisioning_jobs_orderId_fkey`
  FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `provisioning_jobs_vpsInstanceId_fkey`
  FOREIGN KEY (`vpsInstanceId`) REFERENCES `vps_instances`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `provisioning_jobs_customerId_fkey`
  FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `provisioning_task_steps`
  ADD CONSTRAINT `provisioning_task_steps_jobId_fkey`
  FOREIGN KEY (`jobId`) REFERENCES `provisioning_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `provisioning_task_logs`
  ADD CONSTRAINT `provisioning_task_logs_jobId_fkey`
  FOREIGN KEY (`jobId`) REFERENCES `provisioning_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `vps_upgrade_requests`
  ADD CONSTRAINT `vps_upgrade_requests_vpsInstanceId_fkey`
  FOREIGN KEY (`vpsInstanceId`) REFERENCES `vps_instances`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `vps_upgrade_requests_customerId_fkey`
  FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
