CREATE TABLE IF NOT EXISTS "wa_sessions" (
  "id" TEXT NOT NULL,
  "instance_id" TEXT,
  "instance_name" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'evolution',
  "phone_number" TEXT,
  "phone_hash" TEXT,
  "display_name" TEXT,
  "profile_picture_url" TEXT,
  "status" TEXT NOT NULL DEFAULT 'unknown',
  "connected_at" TIMESTAMP(3),
  "last_seen_at" TIMESTAMP(3),
  "last_sync_at" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wa_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_sessions_instance_id_key" ON "wa_sessions"("instance_id");
CREATE UNIQUE INDEX IF NOT EXISTS "wa_sessions_instance_name_key" ON "wa_sessions"("instance_name");
CREATE INDEX IF NOT EXISTS "wa_sessions_provider_status_idx" ON "wa_sessions"("provider", "status");
CREATE INDEX IF NOT EXISTS "wa_sessions_phone_hash_idx" ON "wa_sessions"("phone_hash");
CREATE INDEX IF NOT EXISTS "wa_sessions_last_seen_at_idx" ON "wa_sessions"("last_seen_at");

CREATE TABLE IF NOT EXISTS "wa_groups" (
  "id" TEXT NOT NULL,
  "instance_name" TEXT NOT NULL,
  "remote_jid" TEXT NOT NULL,
  "subject" TEXT,
  "profile_picture_url" TEXT,
  "participant_count" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'active',
  "last_sync_at" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wa_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_groups_instance_name_remote_jid_key" ON "wa_groups"("instance_name", "remote_jid");
CREATE INDEX IF NOT EXISTS "wa_groups_instance_name_status_idx" ON "wa_groups"("instance_name", "status");
CREATE INDEX IF NOT EXISTS "wa_groups_subject_idx" ON "wa_groups"("subject");
CREATE INDEX IF NOT EXISTS "wa_groups_last_sync_at_idx" ON "wa_groups"("last_sync_at");

DO $$
BEGIN
  IF to_regclass('public.wa_instances') IS NOT NULL THEN
    INSERT INTO "wa_sessions" (
      "id",
      "instance_id",
      "instance_name",
      "provider",
      "phone_number",
      "display_name",
      "profile_picture_url",
      "status",
      "connected_at",
      "last_seen_at",
      "last_sync_at",
      "metadata",
      "created_at",
      "updated_at"
    )
    SELECT
      'was_' || "id",
      "instance_id",
      "instance_name",
      "provider",
      "phone_number",
      "display_name",
      "profile_picture_url",
      "status",
      "connected_at",
      "last_seen_at",
      COALESCE("last_sync_at", "updated_at"),
      jsonb_build_object('source', 'wa_instances', 'evolutionOnly', true, 'instanceMetadata', "metadata"),
      "created_at",
      "updated_at"
    FROM "wa_instances"
    ON CONFLICT ("instance_name") DO UPDATE SET
      "instance_id" = EXCLUDED."instance_id",
      "provider" = EXCLUDED."provider",
      "phone_number" = EXCLUDED."phone_number",
      "display_name" = EXCLUDED."display_name",
      "profile_picture_url" = EXCLUDED."profile_picture_url",
      "status" = EXCLUDED."status",
      "connected_at" = EXCLUDED."connected_at",
      "last_seen_at" = EXCLUDED."last_seen_at",
      "last_sync_at" = EXCLUDED."last_sync_at",
      "metadata" = EXCLUDED."metadata",
      "updated_at" = CURRENT_TIMESTAMP;
  END IF;
END $$;
