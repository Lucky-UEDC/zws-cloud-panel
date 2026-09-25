ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "gstPercent" DECIMAL(5, 2) NOT NULL DEFAULT 18.00,
  ADD COLUMN IF NOT EXISTS "gstAmount" DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS "taxLabel" TEXT NOT NULL DEFAULT 'GST';

UPDATE "invoices"
SET
  "gstPercent" = COALESCE("taxRate", 18.00),
  "gstAmount" = COALESCE("taxAmount", 0.00),
  "taxLabel" = COALESCE(NULLIF("taxLabel", ''), 'GST');
