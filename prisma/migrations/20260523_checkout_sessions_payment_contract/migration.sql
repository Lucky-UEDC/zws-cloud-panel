-- Canonical pending checkout/payment session layer.
CREATE TABLE IF NOT EXISTS "checkout_sessions" (
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
  "paidAt" TIMESTAMP(3),
  "fulfilledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "checkout_sessions_referenceId_key" ON "checkout_sessions"("referenceId");
CREATE UNIQUE INDEX IF NOT EXISTS "checkout_sessions_idempotencyKey_key" ON "checkout_sessions"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "checkout_sessions_customerId_status_idx" ON "checkout_sessions"("customerId", "status");
CREATE INDEX IF NOT EXISTS "checkout_sessions_invoiceId_idx" ON "checkout_sessions"("invoiceId");
CREATE INDEX IF NOT EXISTS "checkout_sessions_fulfilledOrderId_idx" ON "checkout_sessions"("fulfilledOrderId");
CREATE INDEX IF NOT EXISTS "checkout_sessions_status_createdAt_idx" ON "checkout_sessions"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "checkout_sessions_purpose_status_idx" ON "checkout_sessions"("purpose", "status");

ALTER TABLE "checkout_sessions"
  ADD CONSTRAINT "checkout_sessions_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "checkoutSessionId" TEXT;

CREATE INDEX IF NOT EXISTS "payments_checkoutSessionId_idx" ON "payments"("checkoutSessionId");

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_checkoutSessionId_fkey"
  FOREIGN KEY ("checkoutSessionId") REFERENCES "checkout_sessions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Enforce one non-empty normalized phone per account table. Postgres permits
-- multiple NULLs, so this keeps optional phone values compatible.
CREATE UNIQUE INDEX IF NOT EXISTS "customers_phone_unique_nonempty"
  ON "customers"("phone")
  WHERE "phone" IS NOT NULL AND "phone" <> '';

CREATE UNIQUE INDEX IF NOT EXISTS "admin_profiles_phone_unique_nonempty"
  ON "admin_profiles"("phone")
  WHERE "phone" IS NOT NULL AND "phone" <> '';
