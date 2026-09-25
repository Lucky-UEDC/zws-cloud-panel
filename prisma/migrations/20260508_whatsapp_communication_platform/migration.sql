ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "phoneVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "whatsappOptIn" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "whatsappLastOtp" TEXT,
  ADD COLUMN IF NOT EXISTS "whatsappOtpExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "whatsappOtpAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "whatsappOtpSentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "whatsappOtpCooldownUntil" TIMESTAMP(3);

UPDATE "customers"
SET
  "phoneVerified" = true,
  "phoneVerifiedAt" = COALESCE("phoneVerifiedAt", NOW()),
  "whatsappOptIn" = true
WHERE "phone" IS NOT NULL
  AND length(trim("phone")) > 0
  AND "phoneVerified" = false;

CREATE INDEX IF NOT EXISTS "customers_phoneVerified_idx" ON "customers"("phoneVerified");
CREATE INDEX IF NOT EXISTS "customers_whatsappOptIn_idx" ON "customers"("whatsappOptIn");

CREATE TABLE IF NOT EXISTS "whatsapp_templates" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'transactional',
  "body" TEXT NOT NULL,
  "variables" JSONB NOT NULL DEFAULT '[]',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_templates_key_key" ON "whatsapp_templates"("key");
CREATE INDEX IF NOT EXISTS "whatsapp_templates_category_idx" ON "whatsapp_templates"("category");
CREATE INDEX IF NOT EXISTS "whatsapp_templates_enabled_idx" ON "whatsapp_templates"("enabled");

CREATE TABLE IF NOT EXISTS "whatsapp_message_logs" (
  "id" TEXT NOT NULL,
  "customerId" TEXT,
  "orderId" TEXT,
  "invoiceId" TEXT,
  "ticketId" TEXT,
  "campaignId" TEXT,
  "campaignLogId" TEXT,
  "toMasked" TEXT NOT NULL,
  "messageType" TEXT NOT NULL DEFAULT 'text',
  "category" TEXT NOT NULL DEFAULT 'transactional',
  "templateKey" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "providerMessageId" TEXT,
  "errorMessage" TEXT,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_message_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_message_logs_customerId_createdAt_idx" ON "whatsapp_message_logs"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_message_logs_campaignId_status_idx" ON "whatsapp_message_logs"("campaignId", "status");
CREATE INDEX IF NOT EXISTS "whatsapp_message_logs_status_createdAt_idx" ON "whatsapp_message_logs"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_message_logs_templateKey_idx" ON "whatsapp_message_logs"("templateKey");

CREATE TABLE IF NOT EXISTS "whatsapp_campaigns" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "audienceFilter" JSONB NOT NULL DEFAULT '{}',
  "message" TEXT NOT NULL,
  "caption" TEXT,
  "mediaUrl" TEXT,
  "mediaPath" TEXT,
  "mediaType" TEXT,
  "scheduledAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "pausedAt" TIMESTAMP(3),
  "total" INTEGER NOT NULL DEFAULT 0,
  "pending" INTEGER NOT NULL DEFAULT 0,
  "sent" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_campaigns_status_scheduledAt_idx" ON "whatsapp_campaigns"("status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "whatsapp_campaigns_createdAt_idx" ON "whatsapp_campaigns"("createdAt");

CREATE TABLE IF NOT EXISTS "whatsapp_campaign_logs" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "customerId" TEXT,
  "toMasked" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "providerMessageId" TEXT,
  "errorMessage" TEXT,
  "pendingAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_campaign_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "whatsapp_campaign_logs_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "whatsapp_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "whatsapp_campaign_logs_campaignId_status_idx" ON "whatsapp_campaign_logs"("campaignId", "status");
CREATE INDEX IF NOT EXISTS "whatsapp_campaign_logs_customerId_createdAt_idx" ON "whatsapp_campaign_logs"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_campaign_logs_status_createdAt_idx" ON "whatsapp_campaign_logs"("status", "createdAt");

CREATE TABLE IF NOT EXISTS "whatsapp_automation_rules" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "condition" JSONB NOT NULL DEFAULT '{}',
  "templateKey" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "delayMinutes" INTEGER NOT NULL DEFAULT 0,
  "lastRunAt" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_automation_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_automation_rules_eventType_enabled_idx" ON "whatsapp_automation_rules"("eventType", "enabled");
CREATE INDEX IF NOT EXISTS "whatsapp_automation_rules_enabled_lastRunAt_idx" ON "whatsapp_automation_rules"("enabled", "lastRunAt");

CREATE TABLE IF NOT EXISTS "customer_notification_preferences" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
  "whatsappEnabled" BOOLEAN NOT NULL DEFAULT true,
  "marketingEnabled" BOOLEAN NOT NULL DEFAULT true,
  "transactionalEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_notification_preferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_notification_preferences_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_notification_preferences_customerId_category_key" ON "customer_notification_preferences"("customerId", "category");
CREATE INDEX IF NOT EXISTS "customer_notification_preferences_category_idx" ON "customer_notification_preferences"("category");

INSERT INTO "whatsapp_templates" ("id", "key", "name", "category", "body", "variables")
VALUES
  ('wa_tpl_signup_success', 'signup_success', 'Signup success', 'auth', 'Hi {{name}}, welcome to ZWS Cloud. Please verify your mobile number to activate WhatsApp notifications.', '["name"]'),
  ('wa_tpl_mobile_verification', 'mobile_verification', 'Mobile verification OTP', 'auth', 'Your ZWS Cloud verification code is {{otp}}. It expires in {{minutes}} minutes.', '["otp","minutes"]'),
  ('wa_tpl_login_alert', 'login_alert', 'Login alert', 'auth', 'Login alert for ZWS Cloud.\nHi {{name}}, a new login was detected.\nIP: {{loginIp}}\nTime: {{loginTime}}', '["name","loginIp","loginTime"]'),
  ('wa_tpl_order_update', 'order_update', 'Order update', 'order', 'Hi {{name}}, your order {{orderNumber}} update: {{status}}.\nProduct: {{productName}}\nAmount: {{currency}} {{amount}}', '["name","orderNumber","status","productName","currency","amount"]'),
  ('wa_tpl_vps_ready', 'vps_ready', 'VPS ready', 'server', 'Hi {{name}}, your VPS {{serviceName}} is ready.\nIP: {{ip}}\nUsername: {{username}}\nPassword: {{password}}', '["name","serviceName","ip","username","password"]'),
  ('wa_tpl_ticket_reply', 'ticket_reply', 'Support ticket reply', 'support', 'Hi {{name}}, support replied to ticket {{ticketNumber}}: {{subject}}', '["name","ticketNumber","subject"]'),
  ('wa_tpl_promo_offer', 'promo_offer', 'Promotional offer', 'marketing', 'Hi {{name}}, {{message}}', '["name","message"]')
ON CONFLICT ("key") DO NOTHING;
