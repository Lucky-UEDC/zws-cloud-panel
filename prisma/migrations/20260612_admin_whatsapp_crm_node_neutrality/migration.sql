-- WhatsApp CRM storage and final removal of node OS compatibility gates.

ALTER TABLE "system_settings" DROP COLUMN IF EXISTS "windows_only";
ALTER TABLE "system_settings" DROP COLUMN IF EXISTS "linux_only";

DROP TABLE IF EXISTS "template_capabilities";
DROP TABLE IF EXISTS "node_capabilities";

CREATE TABLE IF NOT EXISTS "whatsapp_contacts" (
  "id" TEXT NOT NULL,
  "customerId" TEXT,
  "phoneHash" TEXT NOT NULL,
  "phone_encrypted" TEXT,
  "masked_phone" TEXT NOT NULL,
  "displayName" TEXT,
  "email" TEXT,
  "whatsapp_status" TEXT NOT NULL DEFAULT 'unknown',
  "last_message_at" TIMESTAMP(3),
  "last_message_preview" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_contacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_contacts_phoneHash_key" ON "whatsapp_contacts"("phoneHash");
CREATE INDEX IF NOT EXISTS "whatsapp_contacts_customerId_idx" ON "whatsapp_contacts"("customerId");
CREATE INDEX IF NOT EXISTS "whatsapp_contacts_last_message_at_idx" ON "whatsapp_contacts"("last_message_at");
CREATE INDEX IF NOT EXISTS "whatsapp_contacts_whatsapp_status_idx" ON "whatsapp_contacts"("whatsapp_status");

CREATE TABLE IF NOT EXISTS "whatsapp_conversations" (
  "id" TEXT NOT NULL,
  "contact_id" TEXT,
  "customerId" TEXT,
  "phone_hash" TEXT NOT NULL,
  "masked_phone" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "last_message_at" TIMESTAMP(3),
  "last_message_text" TEXT,
  "unread_count" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_conversations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_conversations_phone_hash_key" ON "whatsapp_conversations"("phone_hash");
CREATE INDEX IF NOT EXISTS "whatsapp_conversations_contact_id_idx" ON "whatsapp_conversations"("contact_id");
CREATE INDEX IF NOT EXISTS "whatsapp_conversations_customerId_idx" ON "whatsapp_conversations"("customerId");
CREATE INDEX IF NOT EXISTS "whatsapp_conversations_status_last_message_at_idx" ON "whatsapp_conversations"("status", "last_message_at");

CREATE TABLE IF NOT EXISTS "whatsapp_conversation_messages" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "customerId" TEXT,
  "message_log_id" TEXT,
  "provider_message_id" TEXT,
  "whatsapp_message_id" TEXT,
  "direction" TEXT NOT NULL DEFAULT 'outbound',
  "status" TEXT NOT NULL DEFAULT 'received',
  "message_type" TEXT NOT NULL DEFAULT 'text',
  "media_type" TEXT,
  "media_url" TEXT,
  "body" TEXT,
  "caption" TEXT,
  "phone_hash" TEXT,
  "masked_phone" TEXT,
  "raw_payload" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_conversation_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_conversation_messages_conversation_id_created_at_idx" ON "whatsapp_conversation_messages"("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "whatsapp_conversation_messages_customerId_created_at_idx" ON "whatsapp_conversation_messages"("customerId", "created_at");
CREATE INDEX IF NOT EXISTS "whatsapp_conversation_messages_direction_created_at_idx" ON "whatsapp_conversation_messages"("direction", "created_at");
CREATE INDEX IF NOT EXISTS "whatsapp_conversation_messages_status_created_at_idx" ON "whatsapp_conversation_messages"("status", "created_at");
CREATE INDEX IF NOT EXISTS "whatsapp_conversation_messages_phone_hash_created_at_idx" ON "whatsapp_conversation_messages"("phone_hash", "created_at");
CREATE INDEX IF NOT EXISTS "whatsapp_conversation_messages_provider_message_id_idx" ON "whatsapp_conversation_messages"("provider_message_id");
CREATE INDEX IF NOT EXISTS "whatsapp_conversation_messages_whatsapp_message_id_idx" ON "whatsapp_conversation_messages"("whatsapp_message_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_conversation_messages_conversation_id_fkey'
  ) THEN
    ALTER TABLE "whatsapp_conversation_messages"
      ADD CONSTRAINT "whatsapp_conversation_messages_conversation_id_fkey"
      FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "whatsapp_auto_reply_rules" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "keywords" JSONB NOT NULL DEFAULT '[]',
  "match_mode" TEXT NOT NULL DEFAULT 'contains',
  "reply_text" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "last_matched_at" TIMESTAMP(3),
  "match_count" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_auto_reply_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_auto_reply_rules_enabled_priority_idx" ON "whatsapp_auto_reply_rules"("enabled", "priority");
CREATE INDEX IF NOT EXISTS "whatsapp_auto_reply_rules_last_matched_at_idx" ON "whatsapp_auto_reply_rules"("last_matched_at");

CREATE TABLE IF NOT EXISTS "whatsapp_webhook_events" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'evolution',
  "event" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'received',
  "provider_message_id" TEXT,
  "whatsapp_message_id" TEXT,
  "phone_hash" TEXT,
  "masked_phone" TEXT,
  "direction" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "error_message" TEXT,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_webhook_events_event_created_at_idx" ON "whatsapp_webhook_events"("event", "created_at");
CREATE INDEX IF NOT EXISTS "whatsapp_webhook_events_status_created_at_idx" ON "whatsapp_webhook_events"("status", "created_at");
CREATE INDEX IF NOT EXISTS "whatsapp_webhook_events_phone_hash_created_at_idx" ON "whatsapp_webhook_events"("phone_hash", "created_at");
CREATE INDEX IF NOT EXISTS "whatsapp_webhook_events_provider_message_id_idx" ON "whatsapp_webhook_events"("provider_message_id");
CREATE INDEX IF NOT EXISTS "whatsapp_webhook_events_whatsapp_message_id_idx" ON "whatsapp_webhook_events"("whatsapp_message_id");
