CREATE TABLE IF NOT EXISTS "storage_objects" (
  "id" TEXT PRIMARY KEY,
  "provider" TEXT NOT NULL DEFAULT 'local',
  "bucket" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "size" INTEGER NOT NULL DEFAULT 0,
  "mime_type" TEXT NOT NULL DEFAULT 'application/octet-stream',
  "checksum_sha256" TEXT,
  "category" TEXT NOT NULL DEFAULT 'general',
  "visibility" TEXT NOT NULL DEFAULT 'private',
  "source_type" TEXT,
  "source_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "cleanup_error" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "expires_at" TIMESTAMP(3),
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "storage_objects_provider_bucket_path_key" ON "storage_objects" ("provider", "bucket", "path");
CREATE INDEX IF NOT EXISTS "storage_objects_category_created_at_idx" ON "storage_objects" ("category", "created_at");
CREATE INDEX IF NOT EXISTS "storage_objects_visibility_idx" ON "storage_objects" ("visibility");
CREATE INDEX IF NOT EXISTS "storage_objects_source_type_source_id_idx" ON "storage_objects" ("source_type", "source_id");
CREATE INDEX IF NOT EXISTS "storage_objects_expires_at_idx" ON "storage_objects" ("expires_at");
CREATE INDEX IF NOT EXISTS "storage_objects_deleted_at_idx" ON "storage_objects" ("deleted_at");
