CREATE TABLE IF NOT EXISTS "exchange_rates_cache" (
  "id" TEXT NOT NULL,
  "base_currency" TEXT NOT NULL,
  "target_currency" TEXT NOT NULL,
  "rate" DECIMAL(18,8) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exchange_rates_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "exchange_rates_cache_base_currency_target_currency_key"
  ON "exchange_rates_cache"("base_currency", "target_currency");

CREATE INDEX IF NOT EXISTS "exchange_rates_cache_updated_at_idx"
  ON "exchange_rates_cache"("updated_at");
