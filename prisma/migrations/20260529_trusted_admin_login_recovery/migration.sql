ALTER TABLE "admin_profiles"
  ADD COLUMN IF NOT EXISTS "trusted_admin" BOOLEAN NOT NULL DEFAULT false;

UPDATE "admin_profiles"
SET "trusted_admin" = true
WHERE lower("email") = 'admin@yatycloud.com';
