CREATE TABLE IF NOT EXISTS "email_templates" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "group" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'service',
  "name" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "preheader" TEXT,
  "htmlBody" TEXT NOT NULL,
  "textBody" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_key_key" ON "email_templates"("key");
CREATE INDEX IF NOT EXISTS "email_templates_group_idx" ON "email_templates"("group");
CREATE INDEX IF NOT EXISTS "email_templates_category_idx" ON "email_templates"("category");
CREATE INDEX IF NOT EXISTS "email_templates_enabled_idx" ON "email_templates"("enabled");

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

CREATE TABLE IF NOT EXISTS "email_logs" (
  "id" TEXT NOT NULL,
  "templateKey" TEXT,
  "recipient" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'smtp',
  "error" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "email_logs_templateKey_idx" ON "email_logs"("templateKey");
CREATE INDEX IF NOT EXISTS "email_logs_status_createdAt_idx" ON "email_logs"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "email_logs_createdAt_idx" ON "email_logs"("createdAt");
