-- Autonomous WhatsApp runtime ownership, lifecycle tracking, and observability.

ALTER TABLE "whatsapp_message_logs"
  ADD COLUMN IF NOT EXISTS "phoneHash" TEXT,
  ADD COLUMN IF NOT EXISTS "templateName" TEXT,
  ADD COLUMN IF NOT EXISTS "queueName" TEXT,
  ADD COLUMN IF NOT EXISTS "queueJobId" TEXT,
  ADD COLUMN IF NOT EXISTS "whatsappMessageId" TEXT,
  ADD COLUMN IF NOT EXISTS "retryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "providerResponse" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "failureReason" TEXT,
  ADD COLUMN IF NOT EXISTS "stackTrace" TEXT,
  ADD COLUMN IF NOT EXISTS "processingAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sendingAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "abandonedAt" TIMESTAMP(3);

UPDATE "whatsapp_message_logs"
SET "whatsappMessageId" = COALESCE("whatsappMessageId", "providerMessageId")
WHERE "providerMessageId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "whatsapp_message_logs_phoneHash_createdAt_idx" ON "whatsapp_message_logs"("phoneHash", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_message_logs_queueName_status_idx" ON "whatsapp_message_logs"("queueName", "status");
CREATE INDEX IF NOT EXISTS "whatsapp_message_logs_queueJobId_idx" ON "whatsapp_message_logs"("queueJobId");
CREATE INDEX IF NOT EXISTS "whatsapp_message_logs_providerMessageId_idx" ON "whatsapp_message_logs"("providerMessageId");
CREATE INDEX IF NOT EXISTS "whatsapp_message_logs_whatsappMessageId_idx" ON "whatsapp_message_logs"("whatsappMessageId");

ALTER TABLE "whatsapp_campaigns"
  ADD COLUMN IF NOT EXISTS "queued" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "processing" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "delivered" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "read" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "retries" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "abandoned" INTEGER NOT NULL DEFAULT 0;

UPDATE "whatsapp_campaigns"
SET
  "queued" = GREATEST("queued", "pending"),
  "delivered" = GREATEST("delivered", 0),
  "read" = GREATEST("read", 0),
  "retries" = GREATEST("retries", "retryCount"),
  "abandoned" = GREATEST("abandoned", 0);

ALTER TABLE "whatsapp_campaign_logs"
  ADD COLUMN IF NOT EXISTS "phoneHash" TEXT,
  ADD COLUMN IF NOT EXISTS "queueName" TEXT,
  ADD COLUMN IF NOT EXISTS "queueJobId" TEXT,
  ADD COLUMN IF NOT EXISTS "whatsappMessageId" TEXT,
  ADD COLUMN IF NOT EXISTS "providerResponse" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "failureReason" TEXT,
  ADD COLUMN IF NOT EXISTS "stackTrace" TEXT,
  ADD COLUMN IF NOT EXISTS "queuedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "processingAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sendingAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "abandonedAt" TIMESTAMP(3);

UPDATE "whatsapp_campaign_logs"
SET
  "queuedAt" = COALESCE("queuedAt", "pendingAt"),
  "whatsappMessageId" = COALESCE("whatsappMessageId", "providerMessageId")
WHERE "queuedAt" IS NULL OR "whatsappMessageId" IS NULL;

CREATE INDEX IF NOT EXISTS "whatsapp_campaign_logs_phoneHash_createdAt_idx" ON "whatsapp_campaign_logs"("phoneHash", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_campaign_logs_queueName_status_idx" ON "whatsapp_campaign_logs"("queueName", "status");
CREATE INDEX IF NOT EXISTS "whatsapp_campaign_logs_queueJobId_idx" ON "whatsapp_campaign_logs"("queueJobId");
CREATE INDEX IF NOT EXISTS "whatsapp_campaign_logs_providerMessageId_idx" ON "whatsapp_campaign_logs"("providerMessageId");
CREATE INDEX IF NOT EXISTS "whatsapp_campaign_logs_whatsappMessageId_idx" ON "whatsapp_campaign_logs"("whatsappMessageId");

CREATE TABLE IF NOT EXISTS "whatsapp_logs" (
  "id" TEXT NOT NULL,
  "level" TEXT NOT NULL DEFAULT 'info',
  "event" TEXT NOT NULL,
  "status" TEXT,
  "message" TEXT,
  "customerId" TEXT,
  "campaignId" TEXT,
  "campaignLogId" TEXT,
  "messageLogId" TEXT,
  "queueName" TEXT,
  "queueJobId" TEXT,
  "phoneHash" TEXT,
  "maskedPhone" TEXT,
  "failureReason" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_logs_createdAt_idx" ON "whatsapp_logs"("createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_logs_event_createdAt_idx" ON "whatsapp_logs"("event", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_logs_level_createdAt_idx" ON "whatsapp_logs"("level", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_logs_status_createdAt_idx" ON "whatsapp_logs"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_logs_queueName_createdAt_idx" ON "whatsapp_logs"("queueName", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_logs_queueJobId_idx" ON "whatsapp_logs"("queueJobId");
CREATE INDEX IF NOT EXISTS "whatsapp_logs_phoneHash_createdAt_idx" ON "whatsapp_logs"("phoneHash", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_logs_campaignId_createdAt_idx" ON "whatsapp_logs"("campaignId", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_logs_customerId_createdAt_idx" ON "whatsapp_logs"("customerId", "createdAt");

CREATE TABLE IF NOT EXISTS "whatsapp_queue_logs" (
  "id" TEXT NOT NULL,
  "queueName" TEXT NOT NULL,
  "queueJobId" TEXT,
  "event" TEXT NOT NULL,
  "status" TEXT,
  "customerId" TEXT,
  "campaignId" TEXT,
  "campaignLogId" TEXT,
  "messageLogId" TEXT,
  "phoneHash" TEXT,
  "maskedPhone" TEXT,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "latencyMs" INTEGER,
  "processingMs" INTEGER,
  "failureReason" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_queue_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_queue_logs_queueName_createdAt_idx" ON "whatsapp_queue_logs"("queueName", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_queue_logs_queueName_status_createdAt_idx" ON "whatsapp_queue_logs"("queueName", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_queue_logs_queueJobId_idx" ON "whatsapp_queue_logs"("queueJobId");
CREATE INDEX IF NOT EXISTS "whatsapp_queue_logs_event_createdAt_idx" ON "whatsapp_queue_logs"("event", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_queue_logs_phoneHash_createdAt_idx" ON "whatsapp_queue_logs"("phoneHash", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_queue_logs_campaignId_createdAt_idx" ON "whatsapp_queue_logs"("campaignId", "createdAt");

CREATE TABLE IF NOT EXISTS "whatsapp_delivery_logs" (
  "id" TEXT NOT NULL,
  "messageLogId" TEXT,
  "campaignId" TEXT,
  "campaignLogId" TEXT,
  "customerId" TEXT,
  "phoneHash" TEXT,
  "maskedPhone" TEXT,
  "whatsappMessageId" TEXT,
  "providerMessageId" TEXT,
  "ack" INTEGER,
  "status" TEXT NOT NULL,
  "providerResponse" JSONB NOT NULL DEFAULT '{}',
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_delivery_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_delivery_logs_createdAt_idx" ON "whatsapp_delivery_logs"("createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_delivery_logs_messageLogId_createdAt_idx" ON "whatsapp_delivery_logs"("messageLogId", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_delivery_logs_campaignId_createdAt_idx" ON "whatsapp_delivery_logs"("campaignId", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_delivery_logs_phoneHash_createdAt_idx" ON "whatsapp_delivery_logs"("phoneHash", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_delivery_logs_providerMessageId_idx" ON "whatsapp_delivery_logs"("providerMessageId");
CREATE INDEX IF NOT EXISTS "whatsapp_delivery_logs_whatsappMessageId_idx" ON "whatsapp_delivery_logs"("whatsappMessageId");
CREATE INDEX IF NOT EXISTS "whatsapp_delivery_logs_status_createdAt_idx" ON "whatsapp_delivery_logs"("status", "createdAt");

CREATE TABLE IF NOT EXISTS "whatsapp_error_logs" (
  "id" TEXT NOT NULL,
  "errorCode" TEXT,
  "failureReason" TEXT,
  "message" TEXT NOT NULL,
  "stackTrace" TEXT,
  "queueName" TEXT,
  "queueJobId" TEXT,
  "customerId" TEXT,
  "campaignId" TEXT,
  "campaignLogId" TEXT,
  "messageLogId" TEXT,
  "phoneHash" TEXT,
  "maskedPhone" TEXT,
  "retryable" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_error_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_error_logs_createdAt_idx" ON "whatsapp_error_logs"("createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_error_logs_failureReason_createdAt_idx" ON "whatsapp_error_logs"("failureReason", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_error_logs_queueName_createdAt_idx" ON "whatsapp_error_logs"("queueName", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_error_logs_queueJobId_idx" ON "whatsapp_error_logs"("queueJobId");
CREATE INDEX IF NOT EXISTS "whatsapp_error_logs_phoneHash_createdAt_idx" ON "whatsapp_error_logs"("phoneHash", "createdAt");
CREATE INDEX IF NOT EXISTS "whatsapp_error_logs_campaignId_createdAt_idx" ON "whatsapp_error_logs"("campaignId", "createdAt");

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
