CREATE TABLE IF NOT EXISTS "payment_gateway_attempts" (
  "id" TEXT NOT NULL,
  "orderId" TEXT,
  "paymentId" TEXT,
  "gateway" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "requestId" TEXT,
  "errorCode" TEXT,
  "safeErrorMessage" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_gateway_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "payment_gateway_attempts_orderId_createdAt_idx" ON "payment_gateway_attempts"("orderId", "createdAt");
CREATE INDEX IF NOT EXISTS "payment_gateway_attempts_paymentId_createdAt_idx" ON "payment_gateway_attempts"("paymentId", "createdAt");
CREATE INDEX IF NOT EXISTS "payment_gateway_attempts_gateway_status_createdAt_idx" ON "payment_gateway_attempts"("gateway", "status", "createdAt");

ALTER TABLE "payment_gateway_attempts"
  ADD CONSTRAINT "payment_gateway_attempts_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payment_gateway_attempts"
  ADD CONSTRAINT "payment_gateway_attempts_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
