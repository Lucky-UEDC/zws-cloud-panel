-- Production notification/payment stability hotfix.
-- Additive only: creates the durable notification ledger and checkout reservation timestamps.

CREATE TABLE IF NOT EXISTS "notification_ledger" (
  "notification_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "sent_at" TIMESTAMP(3),
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "next_retry" TIMESTAMP(3),
  "message_hash" TEXT NOT NULL,
  "delivery_id" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_ledger_pkey" PRIMARY KEY ("notification_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_ledger_customer_id_event_invoice_id_template_id_key"
  ON "notification_ledger"("customer_id", "event", "invoice_id", "template_id");

CREATE UNIQUE INDEX IF NOT EXISTS "notification_ledger_message_hash_key"
  ON "notification_ledger"("message_hash");

CREATE INDEX IF NOT EXISTS "notification_ledger_customer_id_invoice_id_event_idx"
  ON "notification_ledger"("customer_id", "invoice_id", "event");

CREATE INDEX IF NOT EXISTS "notification_ledger_channel_status_next_retry_idx"
  ON "notification_ledger"("channel", "status", "next_retry");

CREATE INDEX IF NOT EXISTS "notification_ledger_status_created_at_idx"
  ON "notification_ledger"("status", "created_at");

ALTER TABLE "checkout_sessions"
  ADD COLUMN IF NOT EXISTS "reserved_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reservation_expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reservation_released_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "checkout_sessions_status_reservation_expires_at_idx"
  ON "checkout_sessions"("status", "reservation_expires_at");
