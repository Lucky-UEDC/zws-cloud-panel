-- Additive completion migration: wallet, ticketing, password reset, payment hardening

ALTER TABLE `customers`
  ADD COLUMN `walletBalance` DECIMAL(12,2) NOT NULL DEFAULT 0.00;

ALTER TABLE `payments`
  ADD COLUMN `purpose` VARCHAR(191) NOT NULL DEFAULT 'order_payment',
  ADD COLUMN `idempotencyKey` VARCHAR(191) NULL,
  ADD COLUMN `topupReference` VARCHAR(191) NULL,
  ADD COLUMN `walletAppliedAmount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `gatewayAmount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `webhookProcessedAt` DATETIME(3) NULL;

CREATE INDEX `payments_idempotencyKey_idx` ON `payments`(`idempotencyKey`);
CREATE INDEX `payments_purpose_idx` ON `payments`(`purpose`);

CREATE TABLE `wallet_transactions` (
  `id` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NOT NULL,
  `paymentId` VARCHAR(191) NULL,
  `type` VARCHAR(191) NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `balanceBefore` DECIMAL(12,2) NOT NULL,
  `balanceAfter` DECIMAL(12,2) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'completed',
  `reason` TEXT NULL,
  `note` TEXT NULL,
  `referenceId` VARCHAR(191) NULL,
  `createdByAdminId` VARCHAR(191) NULL,
  `createdByType` VARCHAR(191) NOT NULL DEFAULT 'system',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `wallet_transactions_customerId_createdAt_idx` ON `wallet_transactions`(`customerId`, `createdAt`);
CREATE INDEX `wallet_transactions_type_idx` ON `wallet_transactions`(`type`);
CREATE INDEX `wallet_transactions_status_idx` ON `wallet_transactions`(`status`);

ALTER TABLE `wallet_transactions`
  ADD CONSTRAINT `wallet_transactions_customerId_fkey`
    FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `wallet_transactions_paymentId_fkey`
    FOREIGN KEY (`paymentId`) REFERENCES `payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `wallet_transactions_createdByAdminId_fkey`
    FOREIGN KEY (`createdByAdminId`) REFERENCES `admin_profiles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `support_tickets` (
  `id` VARCHAR(191) NOT NULL,
  `ticketNumber` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NOT NULL,
  `createdByAdminId` VARCHAR(191) NULL,
  `subject` VARCHAR(191) NOT NULL,
  `category` VARCHAR(191) NOT NULL DEFAULT 'general',
  `priority` VARCHAR(191) NOT NULL DEFAULT 'medium',
  `status` VARCHAR(191) NOT NULL DEFAULT 'open',
  `source` VARCHAR(191) NOT NULL DEFAULT 'web',
  `assignedAdminId` VARCHAR(191) NULL,
  `metadata` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `closedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `support_tickets_ticketNumber_key`(`ticketNumber`),
  INDEX `support_tickets_customerId_createdAt_idx`(`customerId`, `createdAt`),
  INDEX `support_tickets_status_priority_idx`(`status`, `priority`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `support_tickets`
  ADD CONSTRAINT `support_tickets_customerId_fkey`
    FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `support_tickets_createdByAdminId_fkey`
    FOREIGN KEY (`createdByAdminId`) REFERENCES `admin_profiles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `support_ticket_messages` (
  `id` VARCHAR(191) NOT NULL,
  `ticketId` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NULL,
  `adminId` VARCHAR(191) NULL,
  `senderType` VARCHAR(191) NOT NULL,
  `body` TEXT NOT NULL,
  `internalOnly` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `support_ticket_messages_ticketId_createdAt_idx`(`ticketId`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `support_ticket_messages`
  ADD CONSTRAINT `support_ticket_messages_ticketId_fkey`
    FOREIGN KEY (`ticketId`) REFERENCES `support_tickets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `support_ticket_messages_customerId_fkey`
    FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `support_ticket_messages_adminId_fkey`
    FOREIGN KEY (`adminId`) REFERENCES `admin_profiles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `password_reset_tokens` (
  `id` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NOT NULL,
  `token` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `usedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `password_reset_tokens_token_key`(`token`),
  INDEX `password_reset_tokens_customerId_createdAt_idx`(`customerId`, `createdAt`),
  INDEX `password_reset_tokens_expiresAt_idx`(`expiresAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `password_reset_tokens`
  ADD CONSTRAINT `password_reset_tokens_customerId_fkey`
    FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
