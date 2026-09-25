ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'service',
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "deleteReason" TEXT;

UPDATE "invoices"
SET "type" = 'wallet_topup'
WHERE "deletedAt" IS NULL
  AND (
    lower(coalesce("metadata"->>'invoiceType', '')) IN ('wallet_topup', 'topup')
    OR lower(coalesce("metadata"->>'paymentPurpose', '')) IN ('wallet_topup', 'topup')
    OR "invoiceNumber" LIKE 'INV-TOPUP-%'
  );

UPDATE "invoices"
SET "type" = 'service'
WHERE "type" IS NULL OR trim("type") = '';

CREATE INDEX IF NOT EXISTS "invoices_type_status_deletedAt_idx"
  ON "invoices"("type", "status", "deletedAt");

CREATE INDEX IF NOT EXISTS "invoices_customerId_status_deletedAt_idx"
  ON "invoices"("customerId", "status", "deletedAt");
