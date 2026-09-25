-- Repair schema drift where the migration ledger is current but api_keys was
-- removed or never created on the production database.
CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "prefix" TEXT NOT NULL,
  "hashedKey" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'reseller',
  "ownerCustomerId" TEXT,
  "scopes" JSONB NOT NULL DEFAULT '[]',
  "rateLimitPerMin" INTEGER NOT NULL DEFAULT 120,
  "lastUsedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_hashedKey_key" ON "api_keys"("hashedKey");
CREATE INDEX IF NOT EXISTS "api_keys_hashedKey_idx" ON "api_keys"("hashedKey");
CREATE INDEX IF NOT EXISTS "api_keys_ownerCustomerId_idx" ON "api_keys"("ownerCustomerId");
