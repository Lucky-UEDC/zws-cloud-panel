CREATE TABLE IF NOT EXISTS "blocked_ips" (
  "id" TEXT NOT NULL,
  "ip" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "attack_type" TEXT,
  "payload_hash" TEXT,
  "payload_sample" TEXT,
  "country" TEXT,
  "asn" TEXT,
  "user_agent" TEXT,
  "device_fingerprint" TEXT,
  "session_id_hash" TEXT,
  "permanent" BOOLEAN NOT NULL DEFAULT true,
  "blocked_until" TIMESTAMP(3),
  "unblocked_at" TIMESTAMP(3),
  "unblocked_by" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "blocked_ips_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "blocked_ips_ip_unblocked_at_idx" ON "blocked_ips"("ip", "unblocked_at");
CREATE INDEX IF NOT EXISTS "blocked_ips_attack_type_created_at_idx" ON "blocked_ips"("attack_type", "created_at");
CREATE INDEX IF NOT EXISTS "blocked_ips_device_fingerprint_idx" ON "blocked_ips"("device_fingerprint");
CREATE INDEX IF NOT EXISTS "blocked_ips_blocked_until_idx" ON "blocked_ips"("blocked_until");

CREATE TABLE IF NOT EXISTS "blocked_devices" (
  "id" TEXT NOT NULL,
  "device_fingerprint" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "attack_type" TEXT,
  "payload_hash" TEXT,
  "payload_sample" TEXT,
  "ip" TEXT,
  "country" TEXT,
  "asn" TEXT,
  "user_agent" TEXT,
  "session_id_hash" TEXT,
  "permanent" BOOLEAN NOT NULL DEFAULT true,
  "blocked_until" TIMESTAMP(3),
  "unblocked_at" TIMESTAMP(3),
  "unblocked_by" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "blocked_devices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "blocked_devices_device_fingerprint_unblocked_at_idx" ON "blocked_devices"("device_fingerprint", "unblocked_at");
CREATE INDEX IF NOT EXISTS "blocked_devices_attack_type_created_at_idx" ON "blocked_devices"("attack_type", "created_at");
CREATE INDEX IF NOT EXISTS "blocked_devices_ip_idx" ON "blocked_devices"("ip");
CREATE INDEX IF NOT EXISTS "blocked_devices_blocked_until_idx" ON "blocked_devices"("blocked_until");

CREATE TABLE IF NOT EXISTS "security_events" (
  "id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'info',
  "route" TEXT,
  "method" TEXT,
  "ip" TEXT,
  "user_agent" TEXT,
  "country" TEXT,
  "asn" TEXT,
  "device_fingerprint" TEXT,
  "session_id_hash" TEXT,
  "customer_id" TEXT,
  "admin_id" TEXT,
  "action_taken" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "security_events_event_type_created_at_idx" ON "security_events"("event_type", "created_at");
CREATE INDEX IF NOT EXISTS "security_events_severity_created_at_idx" ON "security_events"("severity", "created_at");
CREATE INDEX IF NOT EXISTS "security_events_ip_created_at_idx" ON "security_events"("ip", "created_at");
CREATE INDEX IF NOT EXISTS "security_events_device_fingerprint_created_at_idx" ON "security_events"("device_fingerprint", "created_at");
CREATE INDEX IF NOT EXISTS "security_events_customer_id_created_at_idx" ON "security_events"("customer_id", "created_at");
CREATE INDEX IF NOT EXISTS "security_events_admin_id_created_at_idx" ON "security_events"("admin_id", "created_at");

CREATE TABLE IF NOT EXISTS "attack_logs" (
  "id" TEXT NOT NULL,
  "attack_type" TEXT NOT NULL,
  "route" TEXT,
  "method" TEXT,
  "field" TEXT,
  "payload_hash" TEXT,
  "payload_sample" TEXT,
  "normalized_sample" TEXT,
  "ip" TEXT,
  "user_agent" TEXT,
  "country" TEXT,
  "asn" TEXT,
  "device_fingerprint" TEXT,
  "session_id_hash" TEXT,
  "action_taken" TEXT NOT NULL DEFAULT 'logged',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attack_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "attack_logs_attack_type_created_at_idx" ON "attack_logs"("attack_type", "created_at");
CREATE INDEX IF NOT EXISTS "attack_logs_ip_created_at_idx" ON "attack_logs"("ip", "created_at");
CREATE INDEX IF NOT EXISTS "attack_logs_device_fingerprint_created_at_idx" ON "attack_logs"("device_fingerprint", "created_at");
CREATE INDEX IF NOT EXISTS "attack_logs_payload_hash_idx" ON "attack_logs"("payload_hash");

CREATE TABLE IF NOT EXISTS "failed_attempts" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "identifier" TEXT NOT NULL,
  "ip" TEXT,
  "user_agent" TEXT,
  "route" TEXT,
  "method" TEXT,
  "reason" TEXT,
  "device_fingerprint" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "failed_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "failed_attempts_scope_identifier_created_at_idx" ON "failed_attempts"("scope", "identifier", "created_at");
CREATE INDEX IF NOT EXISTS "failed_attempts_scope_ip_created_at_idx" ON "failed_attempts"("scope", "ip", "created_at");
CREATE INDEX IF NOT EXISTS "failed_attempts_ip_created_at_idx" ON "failed_attempts"("ip", "created_at");
CREATE INDEX IF NOT EXISTS "failed_attempts_device_fingerprint_created_at_idx" ON "failed_attempts"("device_fingerprint", "created_at");
