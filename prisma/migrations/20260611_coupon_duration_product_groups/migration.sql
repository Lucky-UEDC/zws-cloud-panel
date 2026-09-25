ALTER TABLE "coupons"
  ADD COLUMN IF NOT EXISTS "applicableProductGroups" JSONB,
  ADD COLUMN IF NOT EXISTS "duration" TEXT NOT NULL DEFAULT 'FIRST_INVOICE_ONLY',
  ADD COLUMN IF NOT EXISTS "durationCycles" INTEGER;

UPDATE "coupons"
SET "discountType" = 'FIXED'
WHERE "discountType" IS NULL OR TRIM("discountType") = '';

UPDATE "coupons"
SET "duration" = 'FIRST_INVOICE_ONLY'
WHERE "duration" IS NULL OR TRIM("duration") = '';
