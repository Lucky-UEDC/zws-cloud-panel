CREATE TABLE `dedicated_inquiries` (
  `id` VARCHAR(191) NOT NULL,
  `inquiryNumber` VARCHAR(191) NOT NULL,
  `productId` VARCHAR(191) NULL,
  `customerId` VARCHAR(191) NULL,
  `customerEmail` VARCHAR(191) NULL,
  `customerName` VARCHAR(191) NULL,
  `customerPhone` VARCHAR(191) NULL,
  `intent` VARCHAR(191) NOT NULL DEFAULT 'book_now',
  `sourcePath` VARCHAR(191) NULL,
  `sourceHost` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'new',
  `productSnapshot` JSON NOT NULL,
  `metadata` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `dedicated_inquiries_inquiryNumber_key`(`inquiryNumber`),
  INDEX `dedicated_inquiries_status_createdAt_idx`(`status`, `createdAt`),
  INDEX `dedicated_inquiries_productId_createdAt_idx`(`productId`, `createdAt`),
  INDEX `dedicated_inquiries_customerId_createdAt_idx`(`customerId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `dedicated_inquiries`
  ADD CONSTRAINT `dedicated_inquiries_productId_fkey`
  FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `dedicated_inquiries`
  ADD CONSTRAINT `dedicated_inquiries_customerId_fkey`
  FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
