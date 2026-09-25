ALTER TABLE `admin_profiles`
  ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX `admin_profiles_role_isActive_idx` ON `admin_profiles`(`role`, `isActive`);

CREATE TABLE `catalog_categories` (
  `id` VARCHAR(191) NOT NULL,
  `parentId` VARCHAR(191) NULL,
  `slug` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `icon` VARCHAR(191) NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `showInNav` BOOLEAN NOT NULL DEFAULT true,
  `showLandingPage` BOOLEAN NOT NULL DEFAULT true,
  `dropdownBehavior` VARCHAR(191) NOT NULL DEFAULT 'auto',
  `visibility` VARCHAR(191) NOT NULL DEFAULT 'public',
  `metadata` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `catalog_categories_slug_key`(`slug`),
  INDEX `catalog_categories_parentId_isActive_sortOrder_idx`(`parentId`, `isActive`, `sortOrder`),
  INDEX `catalog_categories_showInNav_isActive_idx`(`showInNav`, `isActive`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `catalog_categories`
  ADD CONSTRAINT `catalog_categories_parentId_fkey`
  FOREIGN KEY (`parentId`) REFERENCES `catalog_categories`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `products`
  ADD COLUMN `shortDescription` TEXT NULL,
  ADD COLUMN `categoryId` VARCHAR(191) NULL,
  ADD COLUMN `subcategoryId` VARCHAR(191) NULL,
  ADD COLUMN `type` VARCHAR(191) NOT NULL DEFAULT 'fixed',
  ADD COLUMN `visibility` VARCHAR(191) NOT NULL DEFAULT 'public',
  ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'active',
  ADD COLUMN `billingTerms` JSON NOT NULL,
  ADD COLUMN `regions` JSON NOT NULL,
  ADD COLUMN `specs` JSON NOT NULL,
  ADD COLUMN `optionGroups` JSON NOT NULL,
  ADD COLUMN `serviceAttributes` JSON NOT NULL;

UPDATE `products`
SET
  `billingTerms` = JSON_ARRAY(1, 3, 6, 12, 24),
  `regions` = JSON_ARRAY(),
  `specs` = JSON_OBJECT(),
  `optionGroups` = JSON_ARRAY(),
  `serviceAttributes` = JSON_OBJECT()
WHERE `billingTerms` IS NULL;

CREATE INDEX `products_type_status_idx` ON `products`(`type`, `status`);
CREATE INDEX `products_categoryId_subcategoryId_idx` ON `products`(`categoryId`, `subcategoryId`);

ALTER TABLE `products`
  ADD CONSTRAINT `products_categoryId_fkey`
  FOREIGN KEY (`categoryId`) REFERENCES `catalog_categories`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `products`
  ADD CONSTRAINT `products_subcategoryId_fkey`
  FOREIGN KEY (`subcategoryId`) REFERENCES `catalog_categories`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `support_tickets`
  ADD CONSTRAINT `support_tickets_assignedAdminId_fkey`
  FOREIGN KEY (`assignedAdminId`) REFERENCES `admin_profiles`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
