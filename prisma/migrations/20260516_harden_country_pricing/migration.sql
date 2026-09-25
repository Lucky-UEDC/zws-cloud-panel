UPDATE country_pricing
SET "countryCode" = upper("countryCode"),
    currency = upper(currency),
    "markupType" = 'percent',
    "exchangeOverride" = NULL,
    "roundingRule" = CASE
      WHEN "roundingRule" IN ('nearest_0_99', 'nearest_0_49', 'nearest_integer', 'custom_decimal') THEN "roundingRule"
      WHEN "roundingRule" = 'nearest' THEN 'nearest_integer'
      WHEN "roundingRule" = 'none' THEN 'custom_decimal'
      ELSE 'nearest_0_99'
    END
WHERE true;

DELETE FROM country_pricing
WHERE "countryCode" !~ '^[A-Z]{2}$'
   OR currency !~ '^[A-Z]{3}$'
   OR "markupValue" < 0
   OR "markupValue" > 1000;

ALTER TABLE country_pricing
  ALTER COLUMN "markupType" SET DEFAULT 'percent',
  ALTER COLUMN "roundingRule" SET DEFAULT 'nearest_0_99';

ALTER TABLE country_pricing
  DROP CONSTRAINT IF EXISTS country_pricing_country_code_upper_chk,
  DROP CONSTRAINT IF EXISTS country_pricing_currency_code_chk,
  DROP CONSTRAINT IF EXISTS country_pricing_markup_value_chk,
  DROP CONSTRAINT IF EXISTS country_pricing_markup_type_chk,
  DROP CONSTRAINT IF EXISTS country_pricing_rounding_rule_chk,
  DROP CONSTRAINT IF EXISTS country_pricing_no_exchange_override_chk;

ALTER TABLE country_pricing
  ADD CONSTRAINT country_pricing_country_code_upper_chk CHECK ("countryCode" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT country_pricing_currency_code_chk CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT country_pricing_markup_value_chk CHECK ("markupValue" >= 0 AND "markupValue" <= 1000),
  ADD CONSTRAINT country_pricing_markup_type_chk CHECK ("markupType" = 'percent'),
  ADD CONSTRAINT country_pricing_rounding_rule_chk CHECK ("roundingRule" IN ('nearest_0_99', 'nearest_0_49', 'nearest_integer', 'custom_decimal')),
  ADD CONSTRAINT country_pricing_no_exchange_override_chk CHECK ("exchangeOverride" IS NULL);

INSERT INTO admin_settings (id, key, value, description, "updatedBy", "createdAt", "updatedAt")
VALUES (
  'global_pricing_settings',
  'global_pricing_settings',
  '{"enabled":false,"defaultMarkupPercent":40,"originCountry":"IN","originCurrency":"INR"}'::jsonb,
  'Global country pricing settings',
  'migration',
  now(),
  now()
)
ON CONFLICT (key) DO NOTHING;
