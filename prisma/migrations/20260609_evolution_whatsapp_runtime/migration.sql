-- Evolution API WhatsApp runtime tables.
-- Additive migration: preserves existing whatsapp_* history and introduces wa_* runtime tables.

CREATE TABLE IF NOT EXISTS "wa_instances" (
  "id" TEXT NOT NULL,
  "instance_id" TEXT,
  "instance_name" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'evolution',
  "api_base_url" TEXT,
  "api_token_encrypted" TEXT,
  "webhook_secret_encrypted" TEXT,
  "webhook_url" TEXT,
  "webhook_status" TEXT,
  "phone_number" TEXT,
  "display_name" TEXT,
  "profile_picture_url" TEXT,
  "status" TEXT NOT NULL DEFAULT 'unknown',
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "connected_at" TIMESTAMP(3),
  "last_seen_at" TIMESTAMP(3),
  "last_sync_at" TIMESTAMP(3),
  "message_sent_count" INTEGER NOT NULL DEFAULT 0,
  "message_received_count" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wa_instances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_instances_instance_id_key" ON "wa_instances"("instance_id");
CREATE UNIQUE INDEX IF NOT EXISTS "wa_instances_instance_name_key" ON "wa_instances"("instance_name");
CREATE INDEX IF NOT EXISTS "wa_instances_provider_status_idx" ON "wa_instances"("provider", "status");
CREATE INDEX IF NOT EXISTS "wa_instances_is_default_idx" ON "wa_instances"("is_default");
CREATE INDEX IF NOT EXISTS "wa_instances_last_seen_at_idx" ON "wa_instances"("last_seen_at");

CREATE TABLE IF NOT EXISTS "wa_contacts" (
  "id" TEXT NOT NULL,
  "instance_name" TEXT NOT NULL,
  "remote_jid" TEXT NOT NULL,
  "phone_number" TEXT,
  "phone_hash" TEXT,
  "display_name" TEXT,
  "profile_picture_url" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "last_seen_at" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wa_contacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_contacts_instance_name_remote_jid_key" ON "wa_contacts"("instance_name", "remote_jid");
CREATE INDEX IF NOT EXISTS "wa_contacts_phone_hash_idx" ON "wa_contacts"("phone_hash");
CREATE INDEX IF NOT EXISTS "wa_contacts_display_name_idx" ON "wa_contacts"("display_name");
CREATE INDEX IF NOT EXISTS "wa_contacts_last_seen_at_idx" ON "wa_contacts"("last_seen_at");

CREATE TABLE IF NOT EXISTS "wa_conversations" (
  "id" TEXT NOT NULL,
  "instance_name" TEXT NOT NULL,
  "contact_id" TEXT,
  "remote_jid" TEXT NOT NULL,
  "title" TEXT,
  "is_group" BOOLEAN NOT NULL DEFAULT false,
  "state" TEXT NOT NULL DEFAULT 'open',
  "assigned_admin_id" TEXT,
  "unread_count" INTEGER NOT NULL DEFAULT 0,
  "last_message_at" TIMESTAMP(3),
  "archived_at" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wa_conversations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_conversations_instance_name_remote_jid_key" ON "wa_conversations"("instance_name", "remote_jid");
CREATE INDEX IF NOT EXISTS "wa_conversations_contact_id_idx" ON "wa_conversations"("contact_id");
CREATE INDEX IF NOT EXISTS "wa_conversations_state_last_message_at_idx" ON "wa_conversations"("state", "last_message_at");
CREATE INDEX IF NOT EXISTS "wa_conversations_assigned_admin_id_state_idx" ON "wa_conversations"("assigned_admin_id", "state");
CREATE INDEX IF NOT EXISTS "wa_conversations_unread_count_idx" ON "wa_conversations"("unread_count");

CREATE TABLE IF NOT EXISTS "wa_messages" (
  "id" TEXT NOT NULL,
  "instance_name" TEXT NOT NULL,
  "conversation_id" TEXT,
  "contact_id" TEXT,
  "provider_message_id" TEXT NOT NULL,
  "remote_jid" TEXT NOT NULL,
  "from_me" BOOLEAN NOT NULL DEFAULT false,
  "direction" TEXT NOT NULL,
  "message_type" TEXT NOT NULL DEFAULT 'text',
  "body" TEXT,
  "media_id" TEXT,
  "phone_hash" TEXT,
  "masked_phone" TEXT,
  "status" TEXT NOT NULL DEFAULT 'received',
  "sent_at" TIMESTAMP(3),
  "received_at" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "read_at" TIMESTAMP(3),
  "provider_payload" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wa_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_messages_provider_message_id_key" ON "wa_messages"("provider_message_id");
CREATE INDEX IF NOT EXISTS "wa_messages_instance_name_created_at_idx" ON "wa_messages"("instance_name", "created_at");
CREATE INDEX IF NOT EXISTS "wa_messages_conversation_id_created_at_idx" ON "wa_messages"("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "wa_messages_contact_id_created_at_idx" ON "wa_messages"("contact_id", "created_at");
CREATE INDEX IF NOT EXISTS "wa_messages_phone_hash_created_at_idx" ON "wa_messages"("phone_hash", "created_at");
CREATE INDEX IF NOT EXISTS "wa_messages_status_created_at_idx" ON "wa_messages"("status", "created_at");
CREATE INDEX IF NOT EXISTS "wa_messages_remote_jid_created_at_idx" ON "wa_messages"("remote_jid", "created_at");

CREATE TABLE IF NOT EXISTS "wa_campaigns" (
  "id" TEXT NOT NULL,
  "legacy_campaign_id" TEXT,
  "instance_name" TEXT,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "message_type" TEXT NOT NULL DEFAULT 'text',
  "total" INTEGER NOT NULL DEFAULT 0,
  "sent" INTEGER NOT NULL DEFAULT 0,
  "delivered" INTEGER NOT NULL DEFAULT 0,
  "read" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "scheduled_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wa_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_campaigns_legacy_campaign_id_key" ON "wa_campaigns"("legacy_campaign_id");
CREATE INDEX IF NOT EXISTS "wa_campaigns_instance_name_status_idx" ON "wa_campaigns"("instance_name", "status");
CREATE INDEX IF NOT EXISTS "wa_campaigns_status_scheduled_at_idx" ON "wa_campaigns"("status", "scheduled_at");

CREATE TABLE IF NOT EXISTS "wa_events" (
  "id" TEXT NOT NULL,
  "event_key" TEXT NOT NULL,
  "instance_name" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "provider_message_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'received',
  "payload" JSONB NOT NULL DEFAULT '{}',
  "error_message" TEXT,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wa_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_events_event_key_key" ON "wa_events"("event_key");
CREATE INDEX IF NOT EXISTS "wa_events_instance_name_event_type_received_at_idx" ON "wa_events"("instance_name", "event_type", "received_at");
CREATE INDEX IF NOT EXISTS "wa_events_provider_message_id_idx" ON "wa_events"("provider_message_id");
CREATE INDEX IF NOT EXISTS "wa_events_status_received_at_idx" ON "wa_events"("status", "received_at");

CREATE TABLE IF NOT EXISTS "wa_logs" (
  "id" TEXT NOT NULL,
  "level" TEXT NOT NULL DEFAULT 'info',
  "event" TEXT NOT NULL,
  "instance_name" TEXT,
  "status" TEXT,
  "message" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wa_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "wa_logs_instance_name_created_at_idx" ON "wa_logs"("instance_name", "created_at");
CREATE INDEX IF NOT EXISTS "wa_logs_event_created_at_idx" ON "wa_logs"("event", "created_at");
CREATE INDEX IF NOT EXISTS "wa_logs_level_created_at_idx" ON "wa_logs"("level", "created_at");

CREATE TABLE IF NOT EXISTS "wa_team_inbox" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "assigned_admin_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "priority" TEXT NOT NULL DEFAULT 'normal',
  "unread_count" INTEGER NOT NULL DEFAULT 0,
  "last_message_at" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wa_team_inbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_team_inbox_conversation_id_key" ON "wa_team_inbox"("conversation_id");
CREATE INDEX IF NOT EXISTS "wa_team_inbox_assigned_admin_id_status_idx" ON "wa_team_inbox"("assigned_admin_id", "status");
CREATE INDEX IF NOT EXISTS "wa_team_inbox_status_last_message_at_idx" ON "wa_team_inbox"("status", "last_message_at");

CREATE TABLE IF NOT EXISTS "wa_assignments" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "admin_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "assigned_by" TEXT,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "released_at" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "wa_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "wa_assignments_conversation_id_status_idx" ON "wa_assignments"("conversation_id", "status");
CREATE INDEX IF NOT EXISTS "wa_assignments_admin_id_status_idx" ON "wa_assignments"("admin_id", "status");

CREATE TABLE IF NOT EXISTS "wa_tags" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "color" TEXT,
  "conversation_id" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wa_tags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_tags_slug_key" ON "wa_tags"("slug");
CREATE INDEX IF NOT EXISTS "wa_tags_conversation_id_idx" ON "wa_tags"("conversation_id");

CREATE TABLE IF NOT EXISTS "wa_notes" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "admin_id" TEXT,
  "body" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wa_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "wa_notes_conversation_id_created_at_idx" ON "wa_notes"("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "wa_notes_admin_id_created_at_idx" ON "wa_notes"("admin_id", "created_at");

CREATE TABLE IF NOT EXISTS "wa_media" (
  "id" TEXT NOT NULL,
  "instance_name" TEXT NOT NULL,
  "provider_message_id" TEXT,
  "media_type" TEXT NOT NULL,
  "mime_type" TEXT,
  "file_name" TEXT,
  "storage_provider" TEXT NOT NULL DEFAULT 'evolution',
  "storage_path" TEXT,
  "public_url" TEXT,
  "checksum" TEXT,
  "size_bytes" INTEGER,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "wa_media_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "wa_media_instance_name_media_type_created_at_idx" ON "wa_media"("instance_name", "media_type", "created_at");
CREATE INDEX IF NOT EXISTS "wa_media_provider_message_id_idx" ON "wa_media"("provider_message_id");
CREATE INDEX IF NOT EXISTS "wa_media_deleted_at_idx" ON "wa_media"("deleted_at");

INSERT INTO "wa_campaigns" ("id", "legacy_campaign_id", "name", "status", "message_type", "total", "sent", "delivered", "read", "failed", "scheduled_at", "started_at", "completed_at", "metadata", "created_at", "updated_at")
SELECT
  'wa_' || "id",
  "id",
  "name",
  "status",
  COALESCE("type", 'text'),
  "total",
  "sent",
  "delivered",
  "read",
  "failed",
  "scheduledAt",
  "startedAt",
  "completedAt",
  jsonb_build_object('legacyProvider', "provider", 'source', 'whatsapp_campaigns'),
  "createdAt",
  "updatedAt"
FROM "whatsapp_campaigns"
ON CONFLICT ("legacy_campaign_id") DO NOTHING;

INSERT INTO "wa_instances" ("id", "instance_id", "instance_name", "provider", "api_base_url", "webhook_url", "status", "is_default", "metadata")
VALUES (
  'wa_default_evolution',
  '881af9cc-27ba-4fe4-89a3-76c248d2342c',
  'admin',
  'evolution',
  'https://web.myrdphub.com',
  'https://dev.myrdphub.com/api/whatsapp/webhook',
  'configured',
  true,
  jsonb_build_object('source', '20260609_evolution_whatsapp_runtime')
)
ON CONFLICT ("instance_name") DO UPDATE SET
  "provider" = 'evolution',
  "api_base_url" = COALESCE("wa_instances"."api_base_url", EXCLUDED."api_base_url"),
  "webhook_url" = COALESCE("wa_instances"."webhook_url", EXCLUDED."webhook_url"),
  "is_default" = true,
  "updated_at" = CURRENT_TIMESTAMP;
