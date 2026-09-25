ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "hashedPassword" VARCHAR(191),
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "customers_isActive_idx" ON "customers"("isActive");