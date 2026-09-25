ALTER TABLE "auth_challenges"
  ADD COLUMN "method" TEXT,
  ADD COLUMN "otpHash" TEXT,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "otpExpiresAt" TIMESTAMP(3);

CREATE TABLE "user_mfa_settings" (
  "id" TEXT NOT NULL,
  "userType" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "defaultMethod" TEXT NOT NULL DEFAULT 'whatsapp',
  "whatsappEnabled" BOOLEAN NOT NULL DEFAULT true,
  "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
  "emailFallbackEnabled" BOOLEAN NOT NULL DEFAULT true,
  "recoveryCodesEnabled" BOOLEAN NOT NULL DEFAULT false,
  "trustedDeviceDays" INTEGER NOT NULL DEFAULT 30,
  "totpSecretEncrypted" TEXT,
  "totpEnabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_mfa_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_trusted_devices" (
  "id" TEXT NOT NULL,
  "userType" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deviceFingerprint" TEXT NOT NULL,
  "trustedTokenHash" TEXT NOT NULL,
  "browser" TEXT,
  "os" TEXT,
  "deviceType" TEXT,
  "ip" TEXT,
  "city" TEXT,
  "region" TEXT,
  "country" TEXT,
  "timezone" TEXT,
  "platform" TEXT,
  "asn" TEXT,
  "provider" TEXT,
  "riskLevel" TEXT NOT NULL DEFAULT 'low',
  "trustedUntil" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_trusted_devices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_login_sessions" (
  "id" TEXT NOT NULL,
  "sessionIdHash" TEXT NOT NULL,
  "userType" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "deviceFingerprint" TEXT,
  "trustedDeviceId" TEXT,
  "browser" TEXT,
  "os" TEXT,
  "deviceType" TEXT,
  "ip" TEXT,
  "city" TEXT,
  "region" TEXT,
  "country" TEXT,
  "timezone" TEXT,
  "platform" TEXT,
  "asn" TEXT,
  "provider" TEXT,
  "riskLevel" TEXT NOT NULL DEFAULT 'low',
  "revokedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_login_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_security_events" (
  "id" TEXT NOT NULL,
  "userType" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "ip" TEXT,
  "country" TEXT,
  "city" TEXT,
  "region" TEXT,
  "browser" TEXT,
  "os" TEXT,
  "deviceType" TEXT,
  "riskLevel" TEXT NOT NULL DEFAULT 'low',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_security_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_backup_codes" (
  "id" TEXT NOT NULL,
  "userType" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_backup_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auth_challenges_userType_userId_method_expiresAt_idx" ON "auth_challenges"("userType", "userId", "method", "expiresAt");

CREATE UNIQUE INDEX "user_mfa_settings_userType_userId_key" ON "user_mfa_settings"("userType", "userId");
CREATE INDEX "user_mfa_settings_userType_userId_defaultMethod_idx" ON "user_mfa_settings"("userType", "userId", "defaultMethod");

CREATE UNIQUE INDEX "user_trusted_devices_trustedTokenHash_key" ON "user_trusted_devices"("trustedTokenHash");
CREATE INDEX "user_trusted_devices_userType_userId_revokedAt_idx" ON "user_trusted_devices"("userType", "userId", "revokedAt");
CREATE INDEX "user_trusted_devices_userType_userId_deviceFingerprint_idx" ON "user_trusted_devices"("userType", "userId", "deviceFingerprint");
CREATE INDEX "user_trusted_devices_trustedUntil_idx" ON "user_trusted_devices"("trustedUntil");

CREATE UNIQUE INDEX "user_login_sessions_sessionIdHash_key" ON "user_login_sessions"("sessionIdHash");
CREATE INDEX "user_login_sessions_userType_userId_revokedAt_idx" ON "user_login_sessions"("userType", "userId", "revokedAt");
CREATE INDEX "user_login_sessions_email_idx" ON "user_login_sessions"("email");
CREATE INDEX "user_login_sessions_expiresAt_idx" ON "user_login_sessions"("expiresAt");

CREATE INDEX "user_security_events_userType_userId_createdAt_idx" ON "user_security_events"("userType", "userId", "createdAt");
CREATE INDEX "user_security_events_eventType_createdAt_idx" ON "user_security_events"("eventType", "createdAt");
CREATE INDEX "user_security_events_riskLevel_createdAt_idx" ON "user_security_events"("riskLevel", "createdAt");

CREATE UNIQUE INDEX "user_backup_codes_codeHash_key" ON "user_backup_codes"("codeHash");
CREATE INDEX "user_backup_codes_userType_userId_usedAt_idx" ON "user_backup_codes"("userType", "userId", "usedAt");
