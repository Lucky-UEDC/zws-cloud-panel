UPDATE "country_pricing"
SET "currency" = 'INR',
    "exchangeOverride" = NULL
WHERE "currency" <> 'INR';

UPDATE "domain_gateway_configs"
SET "enabled" = false
WHERE "gateway" NOT IN ('phonepe', 'cashfree');

UPDATE "domain_configs"
SET "allowedGatewayModes" = '["phonepe","cashfree","manual","wallet"]'::jsonb,
    "defaultGateway" = CASE WHEN "defaultGateway" IN ('phonepe', 'cashfree') THEN "defaultGateway" ELSE 'phonepe' END,
    "fallbackGateway" = CASE WHEN "fallbackGateway" IN ('phonepe', 'cashfree') THEN "fallbackGateway" ELSE NULL END;

UPDATE "payment_gateways"
SET "enabled" = false,
    "active" = false,
    "primary" = false,
    "last_health_status" = 'disabled',
    "last_error" = 'Disabled by INR payment lockdown.'
WHERE COALESCE("code", '') NOT IN ('phonepe', 'cashfree')
  AND "provider" NOT IN ('phonepe', 'cashfree');

DO $$
DECLARE
  problem text;
BEGIN
  SELECT table_name INTO problem
  FROM (
    SELECT 'orders' AS table_name WHERE EXISTS (SELECT 1 FROM "orders" WHERE "currency" <> 'INR')
    UNION ALL SELECT 'invoices' WHERE EXISTS (SELECT 1 FROM "invoices" WHERE "currency" <> 'INR')
    UNION ALL SELECT 'payments' WHERE EXISTS (SELECT 1 FROM "payments" WHERE "currency" <> 'INR')
    UNION ALL SELECT 'checkout_intents' WHERE EXISTS (SELECT 1 FROM "checkout_intents" WHERE "currency" <> 'INR')
    UNION ALL SELECT 'payment_attempts' WHERE EXISTS (SELECT 1 FROM "payment_attempts" WHERE "currency" <> 'INR')
    UNION ALL SELECT 'payment_transactions' WHERE EXISTS (SELECT 1 FROM "payment_transactions" WHERE "currency" <> 'INR')
    UNION ALL SELECT 'analytics_conversions' WHERE EXISTS (SELECT 1 FROM "analytics_conversions" WHERE "currency" IS NOT NULL AND "currency" <> 'INR')
  ) blocked
  LIMIT 1;

  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'INR payment lockdown blocked by non-INR rows in %. Run pnpm payment:lock-inr --apply and remediate unresolved rows first.', problem;
  END IF;
END $$;

ALTER TABLE "country_pricing" DROP CONSTRAINT IF EXISTS "country_pricing_inr_only_chk";
ALTER TABLE "country_pricing" ADD CONSTRAINT "country_pricing_inr_only_chk" CHECK ("currency" = 'INR');
ALTER TABLE "orders" ADD CONSTRAINT "orders_inr_only_chk" CHECK ("currency" = 'INR');
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_inr_only_chk" CHECK ("currency" = 'INR');
ALTER TABLE "payments" ADD CONSTRAINT "payments_inr_only_chk" CHECK ("currency" = 'INR');
ALTER TABLE "checkout_intents" ADD CONSTRAINT "checkout_intents_inr_only_chk" CHECK ("currency" = 'INR');
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_inr_only_chk" CHECK ("currency" = 'INR');
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_inr_only_chk" CHECK ("currency" = 'INR');
ALTER TABLE "analytics_conversions" ADD CONSTRAINT "analytics_conversions_inr_only_chk" CHECK ("currency" IS NULL OR "currency" = 'INR');
