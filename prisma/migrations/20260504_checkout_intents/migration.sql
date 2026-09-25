CREATE TABLE IF NOT EXISTS "checkout_intents" (
  "id" TEXT NOT NULL,
  "referenceId" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "customerId" TEXT NOT NULL,
  "invoiceId" TEXT,
  "fulfilledOrderId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "purpose" TEXT NOT NULL DEFAULT 'order_payment',
  "gateway" TEXT,
  "amount" DECIMAL(10,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "snapshot" JSONB NOT NULL DEFAULT '{}',
  "fulfilledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "checkout_intents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "checkout_intents_referenceId_key" ON "checkout_intents"("referenceId");
CREATE UNIQUE INDEX IF NOT EXISTS "checkout_intents_idempotencyKey_key" ON "checkout_intents"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "checkout_intents_customerId_status_idx" ON "checkout_intents"("customerId", "status");
CREATE INDEX IF NOT EXISTS "checkout_intents_invoiceId_idx" ON "checkout_intents"("invoiceId");
CREATE INDEX IF NOT EXISTS "checkout_intents_fulfilledOrderId_idx" ON "checkout_intents"("fulfilledOrderId");
CREATE INDEX IF NOT EXISTS "checkout_intents_status_createdAt_idx" ON "checkout_intents"("status", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'checkoutIntentId'
  ) THEN
    ALTER TABLE "payments" ADD COLUMN "checkoutIntentId" TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "payments_checkoutIntentId_idx" ON "payments"("checkoutIntentId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'checkout_intents_customerId_fkey'
  ) THEN
    ALTER TABLE "checkout_intents"
      ADD CONSTRAINT "checkout_intents_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'payments_checkoutIntentId_fkey'
  ) THEN
    ALTER TABLE "payments"
      ADD CONSTRAINT "payments_checkoutIntentId_fkey"
      FOREIGN KEY ("checkoutIntentId") REFERENCES "checkout_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
