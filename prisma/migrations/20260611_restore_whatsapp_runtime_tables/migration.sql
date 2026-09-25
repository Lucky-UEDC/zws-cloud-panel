-- Forward-only drift repair: production has the historical WhatsApp migrations
-- recorded, but these runtime tables are absent on the live database.

CREATE TABLE IF NOT EXISTS "whatsapp_session_logs" (
  "id" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "status" TEXT,
  "waState" TEXT,
  "reason" TEXT,
  "reconnectCount" INTEGER NOT NULL DEFAULT 0,
  "browserPid" INTEGER,
  "browserMemoryMb" INTEGER,
  "browserUptimeSec" INTEGER,
  "authStatus" TEXT,
  "sessionInvalidated" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_session_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_session_logs_createdAt_idx" ON "whatsapp_session_logs"("createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_session_logs_event_createdAt_idx" ON "whatsapp_session_logs"("event", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_session_logs_status_createdAt_idx" ON "whatsapp_session_logs"("status", "createdAt");

CREATE TABLE IF NOT EXISTS "whatsapp_runtime_state" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'idle',
  "currentWAState" TEXT,
  "qrData" TEXT,
  "lastQrAt" TIMESTAMP(3),
  "lastAuthenticatedAt" TIMESTAMP(3),
  "lastReadyAt" TIMESTAMP(3),
  "lastDisconnectReason" TEXT,
  "lastError" TEXT,
  "reconnectCount" INTEGER NOT NULL DEFAULT 0,
  "lastReconnectAt" TIMESTAMP(3),
  "lastHealthCheckAt" TIMESTAMP(3),
  "browserPid" INTEGER,
  "browserMemoryMb" INTEGER,
  "browserUptimeSec" INTEGER,
  "authStatus" TEXT NOT NULL DEFAULT 'unknown',
  "sessionInvalidated" BOOLEAN NOT NULL DEFAULT false,
  "workerStartedAt" TIMESTAMP(3),
  "workerHeartbeatAt" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_runtime_state_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_runtime_state_status_updatedAt_idx" ON "whatsapp_runtime_state"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "whatsapp_runtime_state_workerHeartbeatAt_idx" ON "whatsapp_runtime_state"("workerHeartbeatAt");

INSERT INTO "whatsapp_runtime_state" ("id", "status", "authStatus", "metadata")
VALUES ('primary', 'idle', 'unknown', '{}')
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "whatsapp_sessions" (
  "id" TEXT NOT NULL,
  "session_name" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "last_connected" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_sessions_session_name_key" ON "whatsapp_sessions"("session_name");
CREATE INDEX IF NOT EXISTS "whatsapp_sessions_status_idx" ON "whatsapp_sessions"("status");
