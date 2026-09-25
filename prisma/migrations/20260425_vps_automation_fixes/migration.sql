ALTER TABLE `orders`
  ADD COLUMN `hostname` VARCHAR(191) NULL,
  ADD COLUMN `adminUsername` VARCHAR(191) NULL,
  ADD COLUMN `passwordEncrypted` TEXT NULL,
  ADD COLUMN `sshPublicKey` TEXT NULL;

ALTER TABLE `provisioning_jobs`
  ADD COLUMN `dedupeKey` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `provisioning_jobs_dedupeKey_key` (`dedupeKey`);

ALTER TABLE `ip_allocations`
  ADD COLUMN `allocationLockKey` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `ip_allocations_allocationLockKey_key` (`allocationLockKey`);
