CREATE TABLE IF NOT EXISTS "oauth_identities" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerSubject" TEXT NOT NULL,
  "userType" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  "displayName" TEXT,
  "avatarUrl" TEXT,
  "accessTokenHash" TEXT,
  "refreshTokenHash" TEXT,
  "accessTokenEncrypted" TEXT,
  "refreshTokenEncrypted" TEXT,
  "tokenScope" TEXT,
  "tokenExpiresAt" TIMESTAMP(3),
  "lastLoginAt" TIMESTAMP(3),
  "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "oauth_identities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "oauth_identities_provider_providerSubject_key" ON "oauth_identities"("provider", "providerSubject");
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_identities_provider_userType_userId_key" ON "oauth_identities"("provider", "userType", "userId");
CREATE INDEX IF NOT EXISTS "oauth_identities_email_idx" ON "oauth_identities"("email");
CREATE INDEX IF NOT EXISTS "oauth_identities_userType_userId_idx" ON "oauth_identities"("userType", "userId");

CREATE TABLE IF NOT EXISTS "backup_destinations" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "rcloneRemote" TEXT,
  "configEncrypted" TEXT,
  "retentionDays" INTEGER NOT NULL DEFAULT 30,
  "scheduleCron" TEXT,
  "lastRunAt" TIMESTAMP(3),
  "lastStatus" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "backup_destinations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "backup_destinations_provider_enabled_idx" ON "backup_destinations"("provider", "enabled");
CREATE INDEX IF NOT EXISTS "backup_destinations_lastRunAt_idx" ON "backup_destinations"("lastRunAt");

CREATE TABLE IF NOT EXISTS "backup_runs" (
  "id" TEXT NOT NULL,
  "destinationId" TEXT,
  "triggerType" TEXT NOT NULL DEFAULT 'manual',
  "status" TEXT NOT NULL DEFAULT 'queued',
  "scope" JSONB NOT NULL DEFAULT '[]',
  "localPath" TEXT,
  "remotePath" TEXT,
  "encryptedPath" TEXT,
  "checksumSha256" TEXT,
  "remoteChecksum" TEXT,
  "sizeBytes" BIGINT,
  "log" TEXT,
  "error" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "backup_runs_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "backup_destinations"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "backup_runs_destinationId_createdAt_idx" ON "backup_runs"("destinationId", "createdAt");
CREATE INDEX IF NOT EXISTS "backup_runs_status_createdAt_idx" ON "backup_runs"("status", "createdAt");

CREATE TABLE IF NOT EXISTS "backup_restore_tests" (
  "id" TEXT NOT NULL,
  "backupRunId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "log" TEXT,
  "error" TEXT,
  "testedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "backup_restore_tests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "backup_restore_tests_backupRunId_fkey" FOREIGN KEY ("backupRunId") REFERENCES "backup_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "backup_restore_tests_backupRunId_createdAt_idx" ON "backup_restore_tests"("backupRunId", "createdAt");
CREATE INDEX IF NOT EXISTS "backup_restore_tests_status_createdAt_idx" ON "backup_restore_tests"("status", "createdAt");

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

ALTER TABLE "oauth_identities" ADD COLUMN IF NOT EXISTS "accessTokenEncrypted" TEXT;
ALTER TABLE "oauth_identities" ADD COLUMN IF NOT EXISTS "refreshTokenEncrypted" TEXT;
ALTER TABLE "oauth_identities" ADD COLUMN IF NOT EXISTS "tokenScope" TEXT;
ALTER TABLE "oauth_identities" ADD COLUMN IF NOT EXISTS "tokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "backup_runs" ADD COLUMN IF NOT EXISTS "encryptedPath" TEXT;
ALTER TABLE "backup_runs" ADD COLUMN IF NOT EXISTS "checksumSha256" TEXT;
ALTER TABLE "backup_runs" ADD COLUMN IF NOT EXISTS "remoteChecksum" TEXT;

INSERT INTO app_settings ("id", "key", "value", "group", "isSecret", "updatedBy", "createdAt", "updatedAt")
VALUES (
  'runtime_security_policy',
  'runtime_security_policy',
  '{"mfaEnforcementEnabled":false}'::jsonb,
  'security',
  false,
  'migration',
  now(),
  now()
)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO app_settings ("id", "key", "value", "group", "isSecret", "updatedBy", "createdAt", "updatedAt")
VALUES (
  'runtime_service_integrations',
  'runtime_service_integrations',
  '{"exchangeRates":{"provider":"openexchangerates","appId":"b6f9bbf96d3f4297be7a92c8e7e8fcb0","symbols":"INR,USD,GBP,EUR,AED,AUD,CAD,SGD,JPY"},"backups":{"provider":"local","retentionDays":30},"googleDriveBackups":{"enabled":false,"folderName":"ZWS Backups"}}'::jsonb,
  'integrations',
  true,
  'migration',
  now(),
  now()
)
ON CONFLICT ("key") DO UPDATE
SET
  "value" = jsonb_set(
    app_settings."value",
    '{exchangeRates}',
    COALESCE(app_settings."value"->'exchangeRates', EXCLUDED."value"->'exchangeRates'),
    true
  ),
  "updatedAt" = now()
WHERE app_settings."value"->'exchangeRates' IS NULL;
