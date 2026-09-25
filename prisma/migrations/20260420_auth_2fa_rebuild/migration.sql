ALTER TABLE `admin_profiles`
  ADD COLUMN `twoFactorEnabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `twoFactorSecret` VARCHAR(191) NULL,
  ADD COLUMN `twoFactorBackupCodes` JSON NULL,
  ADD COLUMN `twoFactorEnabledAt` DATETIME(3) NULL;

ALTER TABLE `customers`
  ADD COLUMN `twoFactorEnabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `twoFactorSecret` VARCHAR(191) NULL,
  ADD COLUMN `twoFactorBackupCodes` JSON NULL,
  ADD COLUMN `twoFactorEnabledAt` DATETIME(3) NULL;

CREATE TABLE `auth_challenges` (
  `id` VARCHAR(191) NOT NULL,
  `tokenHash` VARCHAR(191) NOT NULL,
  `userType` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `role` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `consumedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `auth_challenges_tokenHash_key`(`tokenHash`),
  INDEX `auth_challenges_userType_userId_expiresAt_idx`(`userType`, `userId`, `expiresAt`),
  INDEX `auth_challenges_expiresAt_idx`(`expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
