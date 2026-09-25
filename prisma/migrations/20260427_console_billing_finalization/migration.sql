ALTER TABLE "vps_instances"
  ADD COLUMN IF NOT EXISTS "renewalReminder0SentAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "payment_webhook_events" (
  "id" TEXT NOT NULL,
  "gateway" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT,
  "gatewayOrderId" TEXT,
  "gatewayPaymentId" TEXT,
  "paymentId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'received',
  "rawBodyHash" TEXT NOT NULL,
  "payload" JSONB,
  "processedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_webhook_events_gateway_eventId_key"
  ON "payment_webhook_events"("gateway", "eventId");
CREATE INDEX IF NOT EXISTS "payment_webhook_events_gatewayOrderId_idx"
  ON "payment_webhook_events"("gatewayOrderId");
CREATE INDEX IF NOT EXISTS "payment_webhook_events_gatewayPaymentId_idx"
  ON "payment_webhook_events"("gatewayPaymentId");
CREATE INDEX IF NOT EXISTS "payment_webhook_events_status_createdAt_idx"
  ON "payment_webhook_events"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "payment_webhook_events_processedAt_idx"
  ON "payment_webhook_events"("processedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_webhook_events_paymentId_fkey'
  ) THEN
    ALTER TABLE "payment_webhook_events"
      ADD CONSTRAINT "payment_webhook_events_paymentId_fkey"
      FOREIGN KEY ("paymentId") REFERENCES "payments"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
