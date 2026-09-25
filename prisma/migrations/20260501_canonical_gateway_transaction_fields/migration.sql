ALTER TABLE "payment_attempts"
  ADD COLUMN IF NOT EXISTS "approvedPaymentDomain" TEXT,
  ADD COLUMN IF NOT EXISTS "gatewayOrderId" TEXT,
  ADD COLUMN IF NOT EXISTS "gatewayTransactionId" TEXT,
  ADD COLUMN IF NOT EXISTS "gatewayReferenceId" TEXT,
  ADD COLUMN IF NOT EXISTS "bankReferenceId" TEXT,
  ADD COLUMN IF NOT EXISTS "utr" TEXT;

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "transactionId" TEXT,
  ADD COLUMN IF NOT EXISTS "gatewayTransactionId" TEXT;

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "paymentTransactionId" TEXT;

UPDATE "payment_attempts"
SET "approvedPaymentDomain" = COALESCE("approvedPaymentDomain", "approvedDomain")
WHERE "approvedPaymentDomain" IS NULL AND "approvedDomain" IS NOT NULL;

UPDATE "payments"
SET "transactionId" = COALESCE("transactionId", "gatewayPaymentId"),
    "gatewayTransactionId" = COALESCE("gatewayTransactionId", "gatewayPaymentId")
WHERE "gatewayPaymentId" IS NOT NULL
  AND ("transactionId" IS NULL OR "gatewayTransactionId" IS NULL);

UPDATE "invoices" i
SET "paymentTransactionId" = COALESCE(
  i."paymentTransactionId",
  p."gatewayTransactionId",
  p."transactionId",
  p."gatewayPaymentId",
  p."gatewayOrderId"
)
FROM "payments" p
WHERE p."invoiceId" = i."id"
  AND i."paymentTransactionId" IS NULL;

CREATE INDEX IF NOT EXISTS "payment_attempts_approvedPaymentDomain_idx" ON "payment_attempts"("approvedPaymentDomain");
CREATE INDEX IF NOT EXISTS "payment_attempts_gatewayOrderId_idx" ON "payment_attempts"("gatewayOrderId");
CREATE INDEX IF NOT EXISTS "payment_attempts_gatewayPaymentId_idx" ON "payment_attempts"("gatewayPaymentId");
CREATE INDEX IF NOT EXISTS "payment_attempts_gatewayTransactionId_idx" ON "payment_attempts"("gatewayTransactionId");
CREATE INDEX IF NOT EXISTS "payments_transactionId_idx" ON "payments"("transactionId");
CREATE INDEX IF NOT EXISTS "payments_gatewayTransactionId_idx" ON "payments"("gatewayTransactionId");
