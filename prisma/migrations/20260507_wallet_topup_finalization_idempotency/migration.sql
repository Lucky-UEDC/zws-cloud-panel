ALTER TABLE "wallet_transactions"
  ADD COLUMN IF NOT EXISTS "paymentAttemptId" TEXT;

CREATE INDEX IF NOT EXISTS "wallet_transactions_paymentAttemptId_idx"
  ON "wallet_transactions"("paymentAttemptId");

CREATE UNIQUE INDEX IF NOT EXISTS "wallet_transactions_paymentAttemptId_key"
  ON "wallet_transactions"("paymentAttemptId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transactions_paymentAttemptId_fkey'
  ) THEN
    ALTER TABLE "wallet_transactions"
      ADD CONSTRAINT "wallet_transactions_paymentAttemptId_fkey"
      FOREIGN KEY ("paymentAttemptId")
      REFERENCES "payment_attempts"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "payments_topup_completed_gateway_order_unique"
  ON "payments"("gatewayOrderId")
  WHERE "purpose" IN ('wallet_topup', 'topup')
    AND "status" IN ('completed', 'paid', 'success', 'verification_pending')
    AND "gatewayOrderId" IS NOT NULL;
