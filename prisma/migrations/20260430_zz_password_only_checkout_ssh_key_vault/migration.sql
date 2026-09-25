ALTER TABLE "ssh_keys"
  ADD COLUMN IF NOT EXISTS "privateKeyEnc" TEXT,
  ADD COLUMN IF NOT EXISTS "privateKeyIv" TEXT,
  ADD COLUMN IF NOT EXISTS "privateKeyTag" TEXT,
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'uploaded';

UPDATE "ssh_keys"
SET "source" = 'uploaded'
WHERE "source" IS NULL OR "source" = '';
