-- Prevent duplicate Cashfree success processing on replay/reconcile by enforcing unique gateway ids when present.
CREATE UNIQUE INDEX IF NOT EXISTS "payments_gatewayPaymentId_unique_not_null"
  ON "payments"("gatewayPaymentId")
  WHERE "gatewayPaymentId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "payments_gatewayTransactionId_unique_not_null"
  ON "payments"("gatewayTransactionId")
  WHERE "gatewayTransactionId" IS NOT NULL;

