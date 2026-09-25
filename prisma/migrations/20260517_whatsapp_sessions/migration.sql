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
