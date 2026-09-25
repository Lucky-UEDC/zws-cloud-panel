UPDATE "domain_configs"
SET
  "domain" = 'zwscloud.com',
  "appBaseUrl" = 'https://zwscloud.com',
  "displayName" = COALESCE(NULLIF("displayName", ''), 'ZWS Cloud'),
  "updatedAt" = NOW()
WHERE "domain" = 'freerdp.in';

UPDATE "domain_gateway_configs"
SET
  "approvedPaymentDomain" = CASE WHEN "approvedPaymentDomain" = 'freerdp.in' THEN 'zwscloud.com' ELSE "approvedPaymentDomain" END,
  "webhookUrl" = REPLACE("webhookUrl", 'https://freerdp.in', 'https://zwscloud.com'),
  "returnUrl" = REPLACE("returnUrl", 'https://freerdp.in', 'https://zwscloud.com'),
  "startUrl" = REPLACE("startUrl", 'https://freerdp.in', 'https://zwscloud.com'),
  "updatedAt" = NOW()
WHERE
  "approvedPaymentDomain" = 'freerdp.in'
  OR "webhookUrl" LIKE 'https://freerdp.in%'
  OR "returnUrl" LIKE 'https://freerdp.in%'
  OR "startUrl" LIKE 'https://freerdp.in%';

UPDATE "settings"
SET "value" = REPLACE("value", 'freerdp.in', 'zwscloud.com')
WHERE "key" IN ('general_settings', 'brand_settings')
  AND "value" LIKE '%freerdp.in%';
