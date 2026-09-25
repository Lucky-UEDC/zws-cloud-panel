-- Wallet checkout idempotency and cached VPS disk usage.
DROP INDEX IF EXISTS "payments_idempotencyKey_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "payments_idempotencyKey_key"
  ON "payments"("idempotencyKey");

ALTER TABLE "vps_instances"
  ADD COLUMN IF NOT EXISTS "diskUsedGb" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "diskTotalGb" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "diskUsagePercent" DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "diskUsageCheckedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "diskUsageSource" TEXT;
