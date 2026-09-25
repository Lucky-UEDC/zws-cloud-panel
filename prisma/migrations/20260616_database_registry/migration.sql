CREATE TYPE "DatabasePurpose" AS ENUM ('MAIN', 'TEST', 'STAGING', 'CUSTOMER');

CREATE TABLE "database_registry" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "purpose" "DatabasePurpose" NOT NULL DEFAULT 'CUSTOMER',
  "display_name" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "port" INTEGER NOT NULL DEFAULT 5432,
  "database_name" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "encrypted_url" TEXT,
  "ssl_mode" TEXT NOT NULL DEFAULT 'require',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "database_registry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant_database_mappings" (
  "id" TEXT NOT NULL,
  "tenant_key" TEXT NOT NULL,
  "tenant_type" TEXT NOT NULL DEFAULT 'customer',
  "database_registry_id" TEXT NOT NULL,
  "is_primary" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_database_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "database_registry_key_key" ON "database_registry"("key");
CREATE INDEX "database_registry_purpose_is_active_idx" ON "database_registry"("purpose", "is_active");
CREATE INDEX "database_registry_hostname_database_name_idx" ON "database_registry"("hostname", "database_name");
CREATE UNIQUE INDEX "tenant_database_mappings_tenant_key_tenant_type_is_primary_key" ON "tenant_database_mappings"("tenant_key", "tenant_type", "is_primary");
CREATE INDEX "tenant_database_mappings_database_registry_id_idx" ON "tenant_database_mappings"("database_registry_id");

ALTER TABLE "tenant_database_mappings"
  ADD CONSTRAINT "tenant_database_mappings_database_registry_id_fkey"
  FOREIGN KEY ("database_registry_id") REFERENCES "database_registry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
