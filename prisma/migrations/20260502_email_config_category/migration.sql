CREATE TABLE IF NOT EXISTS "email_configs" (
  "id" TEXT NOT NULL,
  "smtpHost" TEXT NOT NULL,
  "smtpPort" INTEGER NOT NULL,
  "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
  "smtpUser" TEXT NOT NULL,
  "smtpPass" TEXT NOT NULL,
  "fromName" TEXT NOT NULL,
  "fromEmail" TEXT NOT NULL,
  "replyTo" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_configs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "email_configs_enabled_idx" ON "email_configs"("enabled");

ALTER TABLE "email_templates"
  ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'service';

CREATE INDEX IF NOT EXISTS "email_templates_category_idx" ON "email_templates"("category");

UPDATE "email_templates"
SET "category" = CASE
  WHEN lower("group") = 'account' THEN 'auth'
  WHEN lower("group") = 'orders' THEN 'billing'
  WHEN lower("group") = 'billing' THEN 'billing'
  WHEN lower("group") = 'services' THEN 'service'
  WHEN lower("group") = 'support' THEN 'support'
  WHEN lower("group") = 'admin' THEN 'admin'
  ELSE 'service'
END
WHERE "category" = 'service' OR "category" IS NULL;

INSERT INTO "email_configs" (
  "id",
  "smtpHost",
  "smtpPort",
  "smtpSecure",
  "smtpUser",
  "smtpPass",
  "fromName",
  "fromEmail",
  "replyTo",
  "enabled",
  "createdAt",
  "updatedAt"
)
SELECT
  'email_config_primary',
  COALESCE(MAX("value" #>> '{}') FILTER (WHERE "key" = 'mail.host'), ''),
  COALESCE(NULLIF(MAX("value" #>> '{}') FILTER (WHERE "key" = 'mail.port'), '')::INTEGER, 587),
  COALESCE(MAX("value" #>> '{}') FILTER (WHERE "key" = 'mail.encryption'), '') IN ('ssl_tls', 'ssl'),
  COALESCE(MAX("value" #>> '{}') FILTER (WHERE "key" = 'mail.username'), ''),
  COALESCE(MAX("value" #>> '{}') FILTER (WHERE "key" = 'mail.password'), ''),
  COALESCE(NULLIF(MAX("value" #>> '{}') FILTER (WHERE "key" = 'mail.mailFromName'), ''), 'ZWS Cloud'),
  COALESCE(NULLIF(MAX("value" #>> '{}') FILTER (WHERE "key" = 'mail.mailFromAddress'), ''), 'noreply@freerdp.in'),
  NULLIF(MAX("value" #>> '{}') FILTER (WHERE "key" = 'mail.replyTo'), ''),
  COALESCE(MAX("value" #>> '{}') FILTER (WHERE "key" = 'mail.enabled'), 'false') = 'true',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "app_settings"
WHERE "group" = 'mail'
HAVING COUNT(*) > 0
ON CONFLICT ("id") DO NOTHING;
