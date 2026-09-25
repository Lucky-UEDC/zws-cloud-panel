CREATE TABLE `plan_sync_runs` (
  `id` VARCHAR(191) NOT NULL,
  `source` VARCHAR(191) NOT NULL DEFAULT 'pricing_internal',
  `triggerType` VARCHAR(191) NOT NULL DEFAULT 'manual',
  `triggeredBy` VARCHAR(191) NULL,
  `synced` INTEGER NOT NULL DEFAULT 0,
  `updated` INTEGER NOT NULL DEFAULT 0,
  `newPlans` INTEGER NOT NULL DEFAULT 0,
  `archived` INTEGER NOT NULL DEFAULT 0,
  `skipped` BOOLEAN NOT NULL DEFAULT false,
  `summary` JSON NOT NULL,
  `error` TEXT NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `plan_sync_runs_startedAt_idx` (`startedAt`),
  INDEX `plan_sync_runs_triggerType_startedAt_idx` (`triggerType`, `startedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
