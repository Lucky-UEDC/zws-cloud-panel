WITH ranked AS (
  SELECT id, "invoiceId",
    row_number() OVER (
      PARTITION BY "invoiceId"
      ORDER BY CASE WHEN "fulfilledAt" IS NOT NULL OR "paidAt" IS NOT NULL THEN 0 ELSE 1 END,
        "createdAt" ASC, id ASC
    ) AS row_number
  FROM "checkout_sessions"
  WHERE "invoiceId" IS NOT NULL AND purpose = 'order_payment'
)
UPDATE "checkout_sessions" AS session
SET "invoiceId" = NULL,
  status = CASE WHEN session.status IN ('paid', 'fulfilled', 'completed') THEN session.status ELSE 'superseded' END,
  snapshot = COALESCE(session.snapshot, '{}'::jsonb) || jsonb_build_object(
    'supersededInvoiceId', ranked."invoiceId", 'supersededAt', CURRENT_TIMESTAMP
  )
FROM ranked
WHERE session.id = ranked.id AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "checkout_sessions_one_order_payment_per_invoice_key"
  ON "checkout_sessions"("invoiceId")
  WHERE "invoiceId" IS NOT NULL AND purpose = 'order_payment';

ALTER TABLE "notification_ledger"
  ALTER COLUMN "invoice_id" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "order_id" TEXT,
  ADD COLUMN IF NOT EXISTS "service_id" TEXT,
  ADD COLUMN IF NOT EXISTS "notification_type" TEXT,
  ADD COLUMN IF NOT EXISTS "scheduled_for" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "provider_message_id" TEXT;

UPDATE "notification_ledger"
SET "notification_type" = COALESCE(NULLIF("notification_type", ''), event),
  "order_id" = COALESCE("order_id", NULLIF(metadata->>'orderId', '')),
  "service_id" = COALESCE("service_id", NULLIF(metadata->>'vpsInstanceId', '')),
  "scheduled_for" = COALESCE("scheduled_for", date_trunc('day', "created_at")),
  "provider_message_id" = COALESCE("provider_message_id", "delivery_id");

ALTER TABLE "notification_ledger" ALTER COLUMN "notification_type" SET NOT NULL;

DROP INDEX IF EXISTS "notification_ledger_customer_id_event_invoice_id_template_id_key";
CREATE INDEX IF NOT EXISTS "notification_ledger_customer_order_type_idx"
  ON "notification_ledger"("customer_id", "order_id", "notification_type");
CREATE INDEX IF NOT EXISTS "notification_ledger_customer_service_type_idx"
  ON "notification_ledger"("customer_id", "service_id", "notification_type");
