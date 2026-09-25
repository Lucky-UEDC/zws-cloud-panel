-- Align new billing-table columns with Prisma's default (unmapped) column naming.
-- The initial `backup_plans_and_snapshot_billing` migration created snake_case
-- columns; the app schema maps only a subset, so Prisma reads the rest with their
-- camelCase field names. These renames are guarded and preserve existing data.

DO $do$
BEGIN
  -- backup_plans
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'backup_plans' AND column_name = 'billing_cycle') THEN
    ALTER TABLE "backup_plans" RENAME COLUMN "billing_cycle" TO "billingCycle";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'backup_plans' AND column_name = 'tax_percent') THEN
    ALTER TABLE "backup_plans" RENAME COLUMN "tax_percent" TO "taxPercent";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'backup_plans' AND column_name = 'max_backups') THEN
    ALTER TABLE "backup_plans" RENAME COLUMN "max_backups" TO "maxBackups";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'backup_plans' AND column_name = 'storage_quota_gb') THEN
    ALTER TABLE "backup_plans" RENAME COLUMN "storage_quota_gb" TO "storageQuotaGb";
  END IF;

  -- snapshot_plans
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'snapshot_plans' AND column_name = 'billing_cycle') THEN
    ALTER TABLE "snapshot_plans" RENAME COLUMN "billing_cycle" TO "billingCycle";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'snapshot_plans' AND column_name = 'tax_percent') THEN
    ALTER TABLE "snapshot_plans" RENAME COLUMN "tax_percent" TO "taxPercent";
  END IF;

  -- wallet_transactions (columns added by the initial billing migration)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wallet_transactions' AND column_name = 'order_id') THEN
    ALTER TABLE "wallet_transactions" RENAME COLUMN "order_id" TO "orderId";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wallet_transactions' AND column_name = 'gateway_fee') THEN
    ALTER TABLE "wallet_transactions" RENAME COLUMN "gateway_fee" TO "gatewayFee";
  END IF;
END $do$;