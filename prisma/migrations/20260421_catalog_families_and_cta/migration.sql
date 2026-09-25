ALTER TABLE `products`
  ADD COLUMN `ctaMode` VARCHAR(191) NOT NULL DEFAULT 'purchase_now',
  ADD COLUMN `ctaLabel` VARCHAR(191) NULL,
  ADD COLUMN `badges` JSON NOT NULL,
  ADD COLUMN `seoTitle` VARCHAR(191) NULL,
  ADD COLUMN `seoDescription` TEXT NULL,
  ADD COLUMN `seoKeywords` JSON NOT NULL,
  ADD COLUMN `whatsappEnabled` BOOLEAN NOT NULL DEFAULT false;

UPDATE `products`
SET `type` = CASE
  WHEN LOWER(`type`) = 'configurable' THEN 'configurable'
  WHEN LOWER(`type`) IN ('service', 'dedicated', 'bms') THEN 'dedicated'
  ELSE 'fixed_vps'
END;

UPDATE `products`
SET
  `ctaMode` = CASE
    WHEN `type` = 'configurable' THEN 'configure'
    ELSE 'purchase_now'
  END,
  `ctaLabel` = CASE
    WHEN `type` = 'configurable' THEN 'Configure'
    ELSE 'Purchase Now'
  END,
  `badges` = JSON_ARRAY(),
  `seoKeywords` = JSON_ARRAY(),
  `whatsappEnabled` = CASE WHEN `type` = 'dedicated' THEN true ELSE false END
WHERE 1=1;

CREATE INDEX `products_type_visibility_status_idx` ON `products`(`type`, `visibility`, `status`);
