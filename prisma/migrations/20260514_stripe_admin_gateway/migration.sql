ALTER TABLE "payment_gateways"
  ADD COLUMN IF NOT EXISTS "code" TEXT,
  ADD COLUMN IF NOT EXISTS "enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS "failsafe_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "config_encrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "config_iv" TEXT,
  ADD COLUMN IF NOT EXISTS "config_tag" TEXT,
  ADD COLUMN IF NOT EXISTS "webhook_secret_encrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "webhook_secret_iv" TEXT,
  ADD COLUMN IF NOT EXISTS "webhook_secret_tag" TEXT,
  ADD COLUMN IF NOT EXISTS "callback_url" TEXT,
  ADD COLUMN IF NOT EXISTS "webhook_url" TEXT,
  ADD COLUMN IF NOT EXISTS "last_health_status" TEXT,
  ADD COLUMN IF NOT EXISTS "last_webhook_status" TEXT,
  ADD COLUMN IF NOT EXISTS "last_payment_status" TEXT,
  ADD COLUMN IF NOT EXISTS "last_error" TEXT;

UPDATE "payment_gateways"
SET
  "code" = COALESCE(NULLIF("code", ''), lower("provider")),
  "enabled" = COALESCE("enabled", "active"),
  "mode" = CASE
    WHEN lower(COALESCE(NULLIF("mode", ''), "environment")) IN ('test', 'sandbox') THEN 'test'
    ELSE 'production'
  END,
  "priority" = CASE WHEN "primary" THEN 10 ELSE COALESCE("priority", 100) END,
  "last_health_status" = COALESCE("last_health_status", 'unknown')
WHERE "provider" IN ('cashfree', 'phonepe', 'stripe');

INSERT INTO "payment_gateways" (
  "id", "name", "provider", "environment", "active", "primary", "credentials",
  "code", "enabled", "mode", "priority", "failsafe_enabled", "last_health_status",
  "createdAt", "updatedAt"
)
VALUES
  ('pgw_admin_cashfree', 'Cashfree', 'cashfree', 'global', false, false, '{}', 'cashfree', false, 'test', 10, true, 'unknown', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pgw_admin_phonepe', 'PhonePe', 'phonepe', 'global', false, false, '{}', 'phonepe', false, 'test', 20, true, 'unknown', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pgw_admin_stripe', 'Stripe', 'stripe', 'global', false, false, '{}', 'stripe', false, 'test', 30, true, 'unknown', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("provider", "environment") DO UPDATE SET
  "code" = EXCLUDED."code",
  "mode" = COALESCE(NULLIF("payment_gateways"."mode", ''), EXCLUDED."mode"),
  "priority" = LEAST(COALESCE("payment_gateways"."priority", EXCLUDED."priority"), EXCLUDED."priority"),
  "last_health_status" = COALESCE("payment_gateways"."last_health_status", EXCLUDED."last_health_status"),
  "updatedAt" = CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "payment_gateways_code_enabled_priority_idx"
  ON "payment_gateways"("code", "enabled", "priority");

ALTER TABLE "payment_gateway_attempts"
  ADD COLUMN IF NOT EXISTS "invoiceId" TEXT,
  ADD COLUMN IF NOT EXISTS "request_payload_safe" JSONB,
  ADD COLUMN IF NOT EXISTS "response_payload_safe" JSONB,
  ADD COLUMN IF NOT EXISTS "error_message" TEXT;

CREATE INDEX IF NOT EXISTS "payment_gateway_attempts_invoiceId_createdAt_idx"
  ON "payment_gateway_attempts"("invoiceId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_gateway_attempts_invoiceId_fkey'
  ) THEN
    ALTER TABLE "payment_gateway_attempts"
      ADD CONSTRAINT "payment_gateway_attempts_invoiceId_fkey"
      FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
