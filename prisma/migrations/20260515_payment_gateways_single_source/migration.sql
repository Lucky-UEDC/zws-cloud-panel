-- Consolidate payment gateway runtime configuration around payment_gateways.
-- Historical migrations remain intact; this migration removes the duplicate
-- unified gateway table and legacy payment columns from system_settings.

DO $$
BEGIN
  IF to_regclass('public.unified_payment_gateway_configs') IS NOT NULL THEN
    INSERT INTO "payment_gateways" (
      "id",
      "name",
      "provider",
      "environment",
      "active",
      "primary",
      "credentials",
      "code",
      "enabled",
      "mode",
      "priority",
      "failsafe_enabled",
      "config_encrypted",
      "config_iv",
      "config_tag",
      "last_health_status",
      "createdAt",
      "updatedAt"
    )
    SELECT DISTINCT ON (LOWER("gateway"))
      'gateway_migrated_' || LOWER("gateway") || '_' || LOWER("environment"),
      COALESCE(NULLIF("displayName", ''), INITCAP("gateway")),
      LOWER("gateway"),
      'global',
      COALESCE("enabled", false),
      COALESCE("priority", 100) <= 10,
      '{}'::jsonb,
      LOWER("gateway"),
      COALESCE("enabled", false),
      CASE WHEN LOWER("environment") IN ('production', 'live') THEN 'production' ELSE 'test' END,
      COALESCE("priority", 100),
      true,
      "credentialsEnc",
      "credentialsIv",
      "credentialsTag",
      COALESCE(NULLIF("healthStatus", ''), 'unknown'),
      COALESCE("createdAt", now()),
      now()
    FROM "unified_payment_gateway_configs"
    WHERE LOWER("gateway") IN ('cashfree', 'phonepe', 'stripe')
    ORDER BY LOWER("gateway"), COALESCE("enabled", false) DESC, COALESCE("priority", 100) ASC, "updatedAt" DESC
    ON CONFLICT ("provider", "environment") DO UPDATE SET
      "code" = EXCLUDED."code",
      "name" = COALESCE(NULLIF("payment_gateways"."name", ''), EXCLUDED."name"),
      "enabled" = "payment_gateways"."enabled" OR EXCLUDED."enabled",
      "active" = "payment_gateways"."active" OR EXCLUDED."active",
      "priority" = LEAST("payment_gateways"."priority", EXCLUDED."priority"),
      "config_encrypted" = COALESCE("payment_gateways"."config_encrypted", EXCLUDED."config_encrypted"),
      "config_iv" = COALESCE("payment_gateways"."config_iv", EXCLUDED."config_iv"),
      "config_tag" = COALESCE("payment_gateways"."config_tag", EXCLUDED."config_tag"),
      "last_health_status" = COALESCE(NULLIF("payment_gateways"."last_health_status", ''), EXCLUDED."last_health_status"),
      "updatedAt" = now();
  END IF;
END $$;

UPDATE "payment_gateways"
SET
  "credentials" = COALESCE("credentials", '{}'::jsonb),
  "code" = LOWER(COALESCE("code", "provider")),
  "webhook_url" = NULL,
  "callback_url" = NULL,
  "updatedAt" = now()
WHERE LOWER(COALESCE("code", "provider")) IN ('cashfree', 'phonepe', 'stripe');

DELETE FROM "payment_gateways"
WHERE LOWER(COALESCE("code", "provider")) IN ('cashfree', 'phonepe', 'stripe')
  AND "environment" <> 'global';

DROP TABLE IF EXISTS "unified_payment_gateway_configs";

ALTER TABLE "system_settings"
  DROP COLUMN IF EXISTS "cashfreeAppId",
  DROP COLUMN IF EXISTS "cashfreeSecretEncrypted",
  DROP COLUMN IF EXISTS "cashfreeWebhookSecretEncrypted",
  DROP COLUMN IF EXISTS "phonepeMerchantId",
  DROP COLUMN IF EXISTS "phonepeSaltEncrypted",
  DROP COLUMN IF EXISTS "phonepeSaltIndex",
  DROP COLUMN IF EXISTS "phonepeWebhookSecretEncrypted";
