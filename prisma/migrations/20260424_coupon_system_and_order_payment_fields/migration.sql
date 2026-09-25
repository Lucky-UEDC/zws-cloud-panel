-- Order payment/coupon extensions
ALTER TABLE `orders`
  ADD COLUMN `originalAmount` DECIMAL(10,2) NULL,
  ADD COLUMN `finalAmount` DECIMAL(10,2) NULL,
  ADD COLUMN `payableAmount` DECIMAL(10,2) NULL,
  ADD COLUMN `couponCode` VARCHAR(191) NULL,
  ADD COLUMN `couponId` VARCHAR(191) NULL,
  ADD COLUMN `gatewayMode` VARCHAR(191) NULL,
  ADD COLUMN `cashfreeOrderId` VARCHAR(191) NULL,
  ADD COLUMN `cashfreePaymentSessionId` VARCHAR(191) NULL;

CREATE INDEX `orders_couponId_idx` ON `orders`(`couponId`);
CREATE INDEX `orders_cashfreeOrderId_idx` ON `orders`(`cashfreeOrderId`);

-- Coupon catalog
CREATE TABLE `coupons` (
  `id` VARCHAR(191) NOT NULL,
  `code` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `discountType` VARCHAR(191) NOT NULL,
  `discountValue` DECIMAL(10,2) NOT NULL,
  `maxDiscountAmount` DECIMAL(10,2) NULL,
  `minOrderAmount` DECIMAL(10,2) NULL,
  `usageLimit` INTEGER NULL,
  `usageLimitPerUser` INTEGER NULL,
  `startsAt` DATETIME(3) NULL,
  `expiresAt` DATETIME(3) NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `applicableProducts` JSON NULL,
  `applicableBillingTerms` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `coupons_code_key`(`code`),
  INDEX `coupons_active_startsAt_expiresAt_idx`(`active`, `startsAt`, `expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Coupon redemption ledger
CREATE TABLE `coupon_redemptions` (
  `id` VARCHAR(191) NOT NULL,
  `couponId` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NOT NULL,
  `paymentId` VARCHAR(191) NULL,
  `discountAmount` DECIMAL(10,2) NOT NULL,
  `redeemedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `status` VARCHAR(191) NOT NULL DEFAULT 'completed',
  `gatewayOrderId` VARCHAR(191) NULL,
  `gatewayPaymentId` VARCHAR(191) NULL,
  `metadata` JSON NULL,

  UNIQUE INDEX `coupon_redemptions_couponId_orderId_key`(`couponId`, `orderId`),
  INDEX `coupon_redemptions_customerId_couponId_idx`(`customerId`, `couponId`),
  INDEX `coupon_redemptions_paymentId_idx`(`paymentId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `orders`
  ADD CONSTRAINT `orders_couponId_fkey`
  FOREIGN KEY (`couponId`) REFERENCES `coupons`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `coupon_redemptions`
  ADD CONSTRAINT `coupon_redemptions_couponId_fkey`
  FOREIGN KEY (`couponId`) REFERENCES `coupons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `coupon_redemptions_orderId_fkey`
  FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `coupon_redemptions_customerId_fkey`
  FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `coupon_redemptions_paymentId_fkey`
  FOREIGN KEY (`paymentId`) REFERENCES `payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX `payments_gatewayOrderId_idx` ON `payments`(`gatewayOrderId`);
CREATE INDEX `payments_gatewayPaymentId_idx` ON `payments`(`gatewayPaymentId`);
