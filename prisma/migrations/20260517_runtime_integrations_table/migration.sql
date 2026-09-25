CREATE TABLE IF NOT EXISTS "runtime_integrations" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "key_name" TEXT NOT NULL,
  "key_value_encrypted" TEXT NOT NULL,
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "runtime_integrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "runtime_integrations_provider_key_name_key" ON "runtime_integrations"("provider", "key_name");
CREATE INDEX IF NOT EXISTS "runtime_integrations_provider_is_enabled_idx" ON "runtime_integrations"("provider", "is_enabled");
