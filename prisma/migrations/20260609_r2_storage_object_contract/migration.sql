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

ALTER TABLE "storage_objects"
  ADD COLUMN IF NOT EXISTS "object_key" TEXT,
  ADD COLUMN IF NOT EXISTS "public_url" TEXT,
  ADD COLUMN IF NOT EXISTS "source_module" TEXT;

UPDATE "storage_objects"
SET
  "object_key" = COALESCE("object_key", "path"),
  "public_url" = COALESCE("public_url", '/api/storage/proxy/' || "path"),
  "source_module" = COALESCE("source_module", "source_type", "category")
WHERE "object_key" IS NULL OR "public_url" IS NULL OR "source_module" IS NULL;

CREATE INDEX IF NOT EXISTS "storage_objects_object_key_idx" ON "storage_objects"("object_key");
CREATE INDEX IF NOT EXISTS "storage_objects_source_module_idx" ON "storage_objects"("source_module");
