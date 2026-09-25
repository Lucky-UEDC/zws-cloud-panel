-- WhatsApp Gateway: messages, contacts, WABA connections, phone numbers, templates
-- Additive tables for the external WhatsApp Gateway provider. Does not modify
-- any existing WhatsApp/Evolution tables or production data.

CREATE TABLE IF NOT EXISTS "whatsapp_gateway_messages" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'whatsapp_gateway',
  "direction" TEXT NOT NULL DEFAULT 'outbound',
  "gateway_id" TEXT,
  "external_message_id" TEXT,
  "wa_message_id" TEXT,
  "contact_id" TEXT,
  "contact_no" TEXT NOT NULL,
  "contact_hash" TEXT,
  "masked_contact" TEXT NOT NULL,
  "contact_name" TEXT,
  "sender_number" TEXT,
  "sender_number_id" TEXT,
  "waba_id" TEXT,
  "message_type" TEXT NOT NULL DEFAULT 'text',
  "message" TEXT,
  "media_url" TEXT,
  "media_name" TEXT,
  "media_mime_type" TEXT,
  "location" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'queued',
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "http_status" INTEGER,
  "latency_ms" INTEGER,
  "provider_response" JSONB NOT NULL DEFAULT '{}',
  "sanitized_error" TEXT,
  "sent_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_gateway_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "whatsapp_gateway_messages_provider_created_at_idx" ON "whatsapp_gateway_messages"("provider", "created_at");
CREATE INDEX IF NOT EXISTS "whatsapp_gateway_messages_contact_no_idx" ON "whatsapp_gateway_messages"("contact_no");
CREATE INDEX IF NOT EXISTS "whatsapp_gateway_messages_contact_id_idx" ON "whatsapp_gateway_messages"("contact_id");
CREATE INDEX IF NOT EXISTS "whatsapp_gateway_messages_wa_message_id_idx" ON "whatsapp_gateway_messages"("wa_message_id");
CREATE INDEX IF NOT EXISTS "whatsapp_gateway_messages_external_message_id_idx" ON "whatsapp_gateway_messages"("external_message_id");
CREATE INDEX IF NOT EXISTS "whatsapp_gateway_messages_status_created_at_idx" ON "whatsapp_gateway_messages"("status", "created_at");
CREATE INDEX IF NOT EXISTS "whatsapp_gateway_messages_message_type_created_at_idx" ON "whatsapp_gateway_messages"("message_type", "created_at");
CREATE INDEX IF NOT EXISTS "whatsapp_gateway_messages_sender_number_idx" ON "whatsapp_gateway_messages"("sender_number");

CREATE TABLE IF NOT EXISTS "whatsapp_gateway_contacts" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'whatsapp_gateway',
  "external_id" TEXT,
  "name" TEXT,
  "phone_number" TEXT NOT NULL,
  "phone_e164" TEXT,
  "email" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_gateway_contacts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "whatsapp_gateway_contacts_provider_phone_number_idx" ON "whatsapp_gateway_contacts"("provider", "phone_number");
CREATE INDEX IF NOT EXISTS "whatsapp_gateway_contacts_provider_created_at_idx" ON "whatsapp_gateway_contacts"("provider", "created_at");
CREATE INDEX IF NOT EXISTS "whatsapp_gateway_contacts_external_id_idx" ON "whatsapp_gateway_contacts"("external_id");

CREATE TABLE IF NOT EXISTS "whatsapp_gateway_wabas" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'whatsapp_gateway',
  "external_id" TEXT NOT NULL,
  "name" TEXT,
  "whatsapp_business_account_id" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "last_synced_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_gateway_wabas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_gateway_wabas_provider_external_id_key" ON "whatsapp_gateway_wabas"("provider", "external_id");
CREATE INDEX IF NOT EXISTS "whatsapp_gateway_wabas_provider_is_active_idx" ON "whatsapp_gateway_wabas"("provider", "is_active");

CREATE TABLE IF NOT EXISTS "whatsapp_gateway_phone_numbers" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'whatsapp_gateway',
  "external_id" TEXT NOT NULL,
  "waba_id" TEXT,
  "waba_external_id" TEXT,
  "display_phone_number" TEXT,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "last_synced_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_gateway_phone_numbers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_gateway_phone_numbers_provider_external_id_key" ON "whatsapp_gateway_phone_numbers"("provider", "external_id");
CREATE INDEX IF NOT EXISTS "whatsapp_gateway_phone_numbers_provider_is_active_idx" ON "whatsapp_gateway_phone_numbers"("provider", "is_active");
CREATE INDEX IF NOT EXISTS "whatsapp_gateway_phone_numbers_waba_id_idx" ON "whatsapp_gateway_phone_numbers"("waba_id");
CREATE INDEX IF NOT EXISTS "whatsapp_gateway_phone_numbers_display_phone_number_idx" ON "whatsapp_gateway_phone_numbers"("display_phone_number");

CREATE TABLE IF NOT EXISTS "whatsapp_gateway_templates" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'whatsapp_gateway',
  "external_id" TEXT,
  "waba_id" TEXT,
  "template_name" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'MARKETING',
  "language" TEXT NOT NULL DEFAULT 'en_US',
  "template_type" TEXT NOT NULL DEFAULT 'standard',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "header_json" JSONB NOT NULL DEFAULT '{}',
  "body_text" TEXT,
  "footer_text" TEXT,
  "buttons_json" JSONB NOT NULL DEFAULT '[]',
  "variables_json" JSONB NOT NULL DEFAULT '[]',
  "components_json" JSONB NOT NULL DEFAULT '{}',
  "otp_config" JSONB NOT NULL DEFAULT '{}',
  "provider_response" JSONB NOT NULL DEFAULT '{}',
  "sanitized_error" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_gateway_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_gateway_templates_provider_waba_id_template_name_key" ON "whatsapp_gateway_templates"("provider", "waba_id", "template_name");
CREATE INDEX IF NOT EXISTS "whatsapp_gateway_templates_provider_waba_id_created_at_idx" ON "whatsapp_gateway_templates"("provider", "waba_id", "created_at");
CREATE INDEX IF NOT EXISTS "whatsapp_gateway_templates_category_idx" ON "whatsapp_gateway_templates"("category");
CREATE INDEX IF NOT EXISTS "whatsapp_gateway_templates_status_updated_at_idx" ON "whatsapp_gateway_templates"("status", "updated_at");
CREATE INDEX IF NOT EXISTS "whatsapp_gateway_templates_language_idx" ON "whatsapp_gateway_templates"("language");

-- Relations (idempotent; parent tables are created above in the same migration).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_gateway_messages_contact_id_fkey') THEN
    ALTER TABLE "whatsapp_gateway_messages"
      ADD CONSTRAINT "whatsapp_gateway_messages_contact_id_fkey"
      FOREIGN KEY ("contact_id") REFERENCES "whatsapp_gateway_contacts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_gateway_phone_numbers_waba_id_fkey') THEN
    ALTER TABLE "whatsapp_gateway_phone_numbers"
      ADD CONSTRAINT "whatsapp_gateway_phone_numbers_waba_id_fkey"
      FOREIGN KEY ("waba_id") REFERENCES "whatsapp_gateway_wabas"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_gateway_templates_waba_id_fkey') THEN
    ALTER TABLE "whatsapp_gateway_templates"
      ADD CONSTRAINT "whatsapp_gateway_templates_waba_id_fkey"
      FOREIGN KEY ("waba_id") REFERENCES "whatsapp_gateway_wabas"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;