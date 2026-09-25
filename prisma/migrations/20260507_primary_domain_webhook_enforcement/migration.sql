WITH primary_domain AS (
  SELECT "domain"
  FROM "domain_configs"
  WHERE "isPrimary" = true
  ORDER BY "updatedAt" DESC
  LIMIT 1
),
active_fallback AS (
  SELECT "domain"
  FROM "domain_configs"
  WHERE "isActive" = true
  ORDER BY "updatedAt" DESC
  LIMIT 1
),
canonical AS (
  SELECT COALESCE(
    (SELECT "domain" FROM primary_domain),
    (SELECT "domain" FROM active_fallback),
    'freerdp.in'
  ) AS domain
)
UPDATE "domain_gateway_configs"
SET "approvedPaymentDomain" = (SELECT domain FROM canonical),
    "updatedAt" = NOW();

WITH canonical AS (
  SELECT COALESCE(
    (SELECT "domain" FROM "domain_configs" WHERE "isPrimary" = true ORDER BY "updatedAt" DESC LIMIT 1),
    (SELECT "domain" FROM "domain_configs" WHERE "isActive" = true ORDER BY "updatedAt" DESC LIMIT 1),
    'freerdp.in'
  ) AS domain
)
UPDATE "payment_attempts"
SET "approvedDomain" = (SELECT domain FROM canonical),
    "approvedPaymentDomain" = (SELECT domain FROM canonical),
    "mode" = 'direct',
    "bridgeUrl" = NULL,
    "updatedAt" = NOW();

ALTER TABLE "payment_webhook_events"
  ADD COLUMN IF NOT EXISTS "requestHost" TEXT,
  ADD COLUMN IF NOT EXISTS "signatureValid" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "requestHeaders" JSONB;

CREATE INDEX IF NOT EXISTS "payment_webhook_events_requestHost_idx"
  ON "payment_webhook_events"("requestHost");

CREATE INDEX IF NOT EXISTS "payment_webhook_events_signatureValid_idx"
  ON "payment_webhook_events"("signatureValid");
