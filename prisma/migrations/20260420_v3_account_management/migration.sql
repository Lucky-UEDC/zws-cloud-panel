-- v3 account management (additive)

CREATE TABLE IF NOT EXISTS `settings` (
  `id` VARCHAR(191) NOT NULL,
  `key` VARCHAR(191) NOT NULL,
  `value` TEXT NOT NULL,
  `updatedBy` VARCHAR(191) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `settings_key_key`(`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `customers`
  ADD COLUMN `status` ENUM('ACTIVE','SUSPENDED','PENDING','BANNED','CLOSED') NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN `suspendedAt` DATETIME(3) NULL,
  ADD COLUMN `suspendedReason` VARCHAR(191) NULL,
  ADD COLUMN `suspendUntil` DATETIME(3) NULL,
  ADD COLUMN `suspendMessage` TEXT NULL,
  ADD COLUMN `bannedAt` DATETIME(3) NULL,
  ADD COLUMN `bannedReason` VARCHAR(191) NULL,
  ADD COLUMN `pendingEmail` VARCHAR(191) NULL,
  ADD COLUMN `internalNotes` TEXT NULL,
  ADD COLUMN `accountType` ENUM('INDIVIDUAL','BUSINESS') NOT NULL DEFAULT 'INDIVIDUAL',
  ADD COLUMN `addressLine1` VARCHAR(191) NULL,
  ADD COLUMN `addressLine2` VARCHAR(191) NULL,
  ADD COLUMN `city` VARCHAR(191) NULL,
  ADD COLUMN `state` VARCHAR(191) NULL,
  ADD COLUMN `postalCode` VARCHAR(191) NULL,
  ADD COLUMN `country` VARCHAR(191) NULL,
  ADD COLUMN `gstin` VARCHAR(191) NULL,
  ADD COLUMN `panNumber` VARCHAR(191) NULL,
  ADD COLUMN `creditLimit` DECIMAL(12,2) NOT NULL DEFAULT 0.00;

CREATE INDEX `customers_status_suspendUntil_idx` ON `customers`(`status`, `suspendUntil`);

CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NULL,
  `adminId` VARCHAR(191) NOT NULL,
  `action` VARCHAR(191) NOT NULL,
  `oldValue` TEXT NULL,
  `newValue` TEXT NULL,
  `ipAddress` VARCHAR(191) NULL,
  `userAgent` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `audit_logs_customerId_createdAt_idx`(`customerId`, `createdAt`),
  INDEX `audit_logs_adminId_createdAt_idx`(`adminId`, `createdAt`),
  INDEX `audit_logs_action_createdAt_idx`(`action`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `audit_logs`
  ADD CONSTRAINT `audit_logs_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `audit_logs_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `admin_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
