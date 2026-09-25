-- Enterprise WhatsApp template framework.
-- Additive and backwards-compatible with the existing whatsapp-web.js sender.

ALTER TABLE "whatsapp_templates"
  ADD COLUMN IF NOT EXISTS "slug" TEXT,
  ADD COLUMN IF NOT EXISTS "language" TEXT NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS "headerType" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS "headerText" TEXT,
  ADD COLUMN IF NOT EXISTS "footer" TEXT,
  ADD COLUMN IF NOT EXISTS "buttons" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "mediaUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "templateVariables" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "isSystem" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

UPDATE "whatsapp_templates"
SET
  "slug" = COALESCE(NULLIF("slug", ''), "key"),
  "templateVariables" = CASE
    WHEN "templateVariables" = '[]'::jsonb THEN COALESCE("variables", '[]'::jsonb)
    ELSE "templateVariables"
  END,
  "isActive" = COALESCE("enabled", true),
  "category" = CASE
    WHEN lower("category") IN ('auth', 'authentication') THEN 'authentication'
    WHEN lower("category") IN ('transactional', 'order', 'invoice', 'billing') THEN 'billing'
    WHEN lower("category") IN ('server', 'service', 'vps', 'provisioning') THEN 'provisioning'
    WHEN lower("category") IN ('support') THEN 'support'
    WHEN lower("category") IN ('marketing', 'campaign') THEN 'marketing'
    WHEN lower("category") IN ('security') THEN 'security'
    WHEN lower("category") IN ('onboarding') THEN 'onboarding'
    ELSE 'utility'
  END;

ALTER TABLE "whatsapp_templates"
  ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_templates_slug_key" ON "whatsapp_templates"("slug");
CREATE INDEX IF NOT EXISTS "whatsapp_templates_language_idx" ON "whatsapp_templates"("language");
CREATE INDEX IF NOT EXISTS "whatsapp_templates_status_idx" ON "whatsapp_templates"("status");
CREATE INDEX IF NOT EXISTS "whatsapp_templates_isActive_idx" ON "whatsapp_templates"("isActive");

CREATE TABLE IF NOT EXISTS "whatsapp_template_versions" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "headerType" TEXT NOT NULL DEFAULT 'none',
  "headerText" TEXT,
  "body" TEXT NOT NULL,
  "footer" TEXT,
  "buttons" JSONB NOT NULL DEFAULT '[]',
  "mediaUrl" TEXT,
  "templateVariables" JSONB NOT NULL DEFAULT '[]',
  "validation" JSONB NOT NULL DEFAULT '{}',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_template_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "whatsapp_template_versions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "whatsapp_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_template_versions_templateId_version_key" ON "whatsapp_template_versions"("templateId", "version");
CREATE INDEX IF NOT EXISTS "whatsapp_template_versions_templateId_createdAt_idx" ON "whatsapp_template_versions"("templateId", "createdAt");

CREATE TABLE IF NOT EXISTS "whatsapp_template_translations" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "headerText" TEXT,
  "body" TEXT NOT NULL,
  "footer" TEXT,
  "buttons" JSONB NOT NULL DEFAULT '[]',
  "mediaUrl" TEXT,
  "templateVariables" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_template_translations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "whatsapp_template_translations_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "whatsapp_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_template_translations_templateId_language_key" ON "whatsapp_template_translations"("templateId", "language");
CREATE INDEX IF NOT EXISTS "whatsapp_template_translations_language_idx" ON "whatsapp_template_translations"("language");
CREATE INDEX IF NOT EXISTS "whatsapp_template_translations_status_idx" ON "whatsapp_template_translations"("status");

CREATE TABLE IF NOT EXISTS "whatsapp_template_variables" (
  "id" TEXT NOT NULL,
  "group" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "sampleValue" TEXT,
  "description" TEXT,
  "sensitive" BOOLEAN NOT NULL DEFAULT false,
  "maskingPolicy" TEXT NOT NULL DEFAULT 'none',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_template_variables_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_template_variables_key_key" ON "whatsapp_template_variables"("key");
CREATE INDEX IF NOT EXISTS "whatsapp_template_variables_group_idx" ON "whatsapp_template_variables"("group");
CREATE INDEX IF NOT EXISTS "whatsapp_template_variables_sensitive_idx" ON "whatsapp_template_variables"("sensitive");

ALTER TABLE "whatsapp_message_logs"
  ADD COLUMN IF NOT EXISTS "templateVersionId" TEXT,
  ADD COLUMN IF NOT EXISTS "templateLanguage" TEXT,
  ADD COLUMN IF NOT EXISTS "clickedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "convertedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "buttonClicks" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "whatsapp_message_logs_templateVersionId_idx" ON "whatsapp_message_logs"("templateVersionId");
CREATE INDEX IF NOT EXISTS "whatsapp_message_logs_templateLanguage_idx" ON "whatsapp_message_logs"("templateLanguage");

UPDATE "whatsapp_templates"
SET "isActive" = false, "enabled" = false, "status" = 'archived'
WHERE "key" IN ('login_otp', 'signup_otp', 'password_reset_otp', 'device_verification_otp', 'mobile_verification');

INSERT INTO "whatsapp_templates" ("id", "key", "name", "slug", "category", "language", "status", "headerType", "body", "footer", "buttons", "templateVariables", "variables", "isSystem", "isActive", "enabled", "updatedBy")
VALUES
  ('wa_tpl_auth_login_otp', 'auth_login_otp', 'Login OTP', 'auth_login_otp', 'authentication', 'en', 'approved', 'none', '━━━━━━━━━━━━━━━
🔐 *ZWS Verification*
━━━━━━━━━━━━━━━

Hello {{first_name}},

Your verification code is:

*{{otp_code}}*

⏳ Valid for 5 minutes

Never share this code with anyone.

━━━━━━━━━━━━━━━
{{company_name}}
━━━━━━━━━━━━━━━', 'Secure login verification', '[]', '["first_name","otp_code","company_name"]', '["first_name","otp_code","company_name"]', true, true, true, 'migration'),
  ('wa_tpl_auth_signup_otp', 'auth_signup_otp', 'Signup OTP', 'auth_signup_otp', 'authentication', 'en', 'approved', 'none', '━━━━━━━━━━━━━━━
🔐 *ZWS Account Verification*
━━━━━━━━━━━━━━━

Hello {{first_name}},

Use this code to verify your account:

*{{otp_code}}*

⏳ Valid for 5 minutes

Never share this code with anyone.

━━━━━━━━━━━━━━━
{{company_name}}
━━━━━━━━━━━━━━━', 'Verification code', '[]', '["first_name","otp_code","company_name"]', '["first_name","otp_code","company_name"]', true, true, true, 'migration'),
  ('wa_tpl_auth_password_reset', 'auth_password_reset', 'Password reset OTP', 'auth_password_reset', 'authentication', 'en', 'approved', 'none', '━━━━━━━━━━━━━━━
🔑 *ZWS Password Reset*
━━━━━━━━━━━━━━━

Hello {{first_name}},

Your password reset code is:

*{{otp_code}}*

⏳ Valid for 5 minutes

If you did not request this, reset your password and contact support.

Never share this code with anyone.

━━━━━━━━━━━━━━━
{{company_name}}
━━━━━━━━━━━━━━━', 'Do not share this code', '[]', '["first_name","otp_code","company_name"]', '["first_name","otp_code","company_name"]', true, true, true, 'migration'),
  ('wa_tpl_auth_device_verify', 'auth_device_verify', 'Device verification OTP', 'auth_device_verify', 'authentication', 'en', 'approved', 'none', '━━━━━━━━━━━━━━━
🛡 *ZWS Device Verification*
━━━━━━━━━━━━━━━

Hello {{first_name}},

Use this code to verify your device:

*{{otp_code}}*

💻 Device: {{browser}} on {{os}}
⏳ Valid for 5 minutes

Never share this code with anyone.

━━━━━━━━━━━━━━━
{{company_name}}
━━━━━━━━━━━━━━━', 'Do not share this code', '[]', '["first_name","otp_code","browser","os","company_name"]', '["first_name","otp_code","browser","os","company_name"]', true, true, true, 'migration')
ON CONFLICT ("key") DO UPDATE SET
  "body" = EXCLUDED."body",
  "footer" = EXCLUDED."footer",
  "templateVariables" = EXCLUDED."templateVariables",
  "variables" = EXCLUDED."variables",
  "isActive" = true,
  "enabled" = true,
  "status" = 'approved';
