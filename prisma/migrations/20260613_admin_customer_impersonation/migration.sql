CREATE TABLE IF NOT EXISTS "admin_customer_impersonation_tokens" (
  "id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "admin_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_ip" TEXT,
  "consumed_ip" TEXT,
  "user_agent" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_customer_impersonation_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "admin_customer_impersonation_tokens_token_hash_key"
  ON "admin_customer_impersonation_tokens"("token_hash");

CREATE INDEX IF NOT EXISTS "admin_customer_impersonation_tokens_admin_id_created_at_idx"
  ON "admin_customer_impersonation_tokens"("admin_id", "created_at");

CREATE INDEX IF NOT EXISTS "admin_customer_impersonation_tokens_customer_id_created_at_idx"
  ON "admin_customer_impersonation_tokens"("customer_id", "created_at");

CREATE INDEX IF NOT EXISTS "admin_customer_impersonation_tokens_expires_at_idx"
  ON "admin_customer_impersonation_tokens"("expires_at");

CREATE INDEX IF NOT EXISTS "admin_customer_impersonation_tokens_consumed_at_idx"
  ON "admin_customer_impersonation_tokens"("consumed_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_customer_impersonation_tokens_admin_id_fkey'
  ) THEN
    ALTER TABLE "admin_customer_impersonation_tokens"
      ADD CONSTRAINT "admin_customer_impersonation_tokens_admin_id_fkey"
      FOREIGN KEY ("admin_id") REFERENCES "admin_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_customer_impersonation_tokens_customer_id_fkey'
  ) THEN
    ALTER TABLE "admin_customer_impersonation_tokens"
      ADD CONSTRAINT "admin_customer_impersonation_tokens_customer_id_fkey"
      FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
