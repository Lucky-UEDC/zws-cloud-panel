CREATE TABLE IF NOT EXISTS "system_security_settings" (
  "id" TEXT NOT NULL,
  "turnstile_enabled" BOOLEAN NOT NULL DEFAULT false,
  "turnstile_site_key" TEXT NOT NULL DEFAULT '',
  "turnstile_secret_key" TEXT NOT NULL DEFAULT '',
  "otp_enabled" BOOLEAN NOT NULL DEFAULT true,
  "rate_limit_enabled" BOOLEAN NOT NULL DEFAULT true,
  "xss_protection_enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "system_security_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "suspicious_requests" (
  "id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'warn',
  "route" TEXT,
  "method" TEXT,
  "ip" TEXT,
  "user_agent" TEXT,
  "country" TEXT,
  "asn" TEXT,
  "device_fingerprint" TEXT,
  "session_id_hash" TEXT,
  "identifier" TEXT,
  "action_taken" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "suspicious_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "suspicious_requests_reason_created_at_idx" ON "suspicious_requests"("reason", "created_at");
CREATE INDEX IF NOT EXISTS "suspicious_requests_ip_created_at_idx" ON "suspicious_requests"("ip", "created_at");
CREATE INDEX IF NOT EXISTS "suspicious_requests_route_created_at_idx" ON "suspicious_requests"("route", "created_at");
CREATE INDEX IF NOT EXISTS "suspicious_requests_device_fingerprint_created_at_idx" ON "suspicious_requests"("device_fingerprint", "created_at");
DO $$
BEGIN
  IF to_regclass('"attack_logs"') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "attack_logs_route_created_at_idx" ON "attack_logs"("route", "created_at");
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"blocked_ips"') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "blocked_ips_ip_blocked_until_idx" ON "blocked_ips"("ip", "blocked_until");
  END IF;
END $$;
