-- Remove legacy PhonePe salt/checksum fields from active runtime storage.
ALTER TABLE "system_settings"
  DROP COLUMN IF EXISTS "phonepeSaltEncrypted",
  DROP COLUMN IF EXISTS "phonepeSaltIndex",
  DROP COLUMN IF EXISTS "salt_key",
  DROP COLUMN IF EXISTS "salt_index";

UPDATE "payment_gateways"
SET "credentials" = (COALESCE("credentials"::jsonb, '{}'::jsonb) - 'saltKey' - 'saltIndex' - 'PHONEPE_SALT_KEY' - 'PHONEPE_SALT_INDEX')::jsonb
WHERE LOWER(COALESCE("code", "provider", '')) = 'phonepe'
  AND "credentials" IS NOT NULL;

UPDATE "domain_gateway_configs"
SET "extraConfig" = (COALESCE("extraConfig"::jsonb, '{}'::jsonb) - 'saltKey' - 'saltIndex' - 'PHONEPE_SALT_KEY' - 'PHONEPE_SALT_INDEX')::jsonb
WHERE LOWER("gateway") = 'phonepe'
  AND "extraConfig" IS NOT NULL;
