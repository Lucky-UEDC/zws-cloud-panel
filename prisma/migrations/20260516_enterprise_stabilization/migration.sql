ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

UPDATE "products"
SET "archivedAt" = COALESCE("archivedAt", "updatedAt")
WHERE "archived" = true AND "archivedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "products_archivedAt_idx" ON "products"("archivedAt");
CREATE INDEX IF NOT EXISTS "products_deletedAt_idx" ON "products"("deletedAt");
CREATE INDEX IF NOT EXISTS "products_visibility_status_isActive_deletedAt_idx" ON "products"("visibility", "status", "isActive", "deletedAt");

CREATE TABLE IF NOT EXISTS "country_pricing" (
  "id" TEXT NOT NULL,
  "countryCode" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "markupType" TEXT NOT NULL,
  "markupValue" DOUBLE PRECISION NOT NULL,
  "exchangeOverride" DOUBLE PRECISION,
  "roundingRule" TEXT NOT NULL DEFAULT 'nearest_0_99',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "country_pricing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "country_pricing_countryCode_key" ON "country_pricing"("countryCode");
CREATE INDEX IF NOT EXISTS "country_pricing_enabled_idx" ON "country_pricing"("enabled");
CREATE INDEX IF NOT EXISTS "country_pricing_currency_idx" ON "country_pricing"("currency");
