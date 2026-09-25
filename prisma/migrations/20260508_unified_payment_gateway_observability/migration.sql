CREATE TABLE IF NOT EXISTS "unified_payment_gateway_configs" (
  "id" TEXT NOT NULL,
  "gateway" TEXT NOT NULL,
  "displayName" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "environment" TEXT NOT NULL DEFAULT 'production',
  "baseUrl" TEXT,
  "credentialsEnc" TEXT,
  "credentialsIv" TEXT,
  "credentialsTag" TEXT,
  "extraConfig" JSONB NOT NULL DEFAULT '{}',
  "healthStatus" TEXT NOT NULL DEFAULT 'unknown',
  "lastHealthyAt" TIMESTAMP(3),
  "lastCheckedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "unified_payment_gateway_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "unified_payment_gateway_configs_gateway_environment_key" ON "unified_payment_gateway_configs"("gateway", "environment");
CREATE INDEX IF NOT EXISTS "unified_payment_gateway_configs_enabled_priority_idx" ON "unified_payment_gateway_configs"("enabled", "priority");
CREATE INDEX IF NOT EXISTS "unified_payment_gateway_configs_gateway_enabled_idx" ON "unified_payment_gateway_configs"("gateway", "enabled");

INSERT INTO "unified_payment_gateway_configs" (
  "id", "gateway", "displayName", "enabled", "priority", "environment",
  "baseUrl", "credentialsEnc", "credentialsIv", "credentialsTag", "extraConfig"
)
SELECT
  'upg_' || "id",
  "gateway",
  COALESCE("displayName", INITCAP("gateway")),
  "enabled",
  "priority",
  "environment",
  COALESCE(NULLIF("approvedPaymentDomain", ''), NULL),
  "credentialsEnc",
  "credentialsIv",
  "credentialsTag",
  jsonb_build_object(
    'migratedFromDomainGatewayConfigId', "id",
    'returnUrl', "returnUrl",
    'webhookUrl', "webhookUrl",
    'startUrl', "startUrl",
    'approvedPaymentDomain', "approvedPaymentDomain",
    'legacyExtraConfig', "extraConfig"
  )
FROM "domain_gateway_configs"
WHERE "gateway" IN ('cashfree', 'phonepe', 'manual', 'wallet')
ON CONFLICT ("gateway", "environment") DO UPDATE SET
  "enabled" = EXCLUDED."enabled",
  "priority" = LEAST("unified_payment_gateway_configs"."priority", EXCLUDED."priority"),
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "unified_payment_gateway_configs" ("id", "gateway", "displayName", "enabled", "priority", "environment")
VALUES
  ('upg_stripe_production', 'stripe', 'Stripe', false, 30, 'production'),
  ('upg_razorpay_production', 'razorpay', 'Razorpay', false, 40, 'production'),
  ('upg_paytm_production', 'paytm', 'Paytm', false, 50, 'production')
ON CONFLICT ("gateway", "environment") DO NOTHING;

CREATE TABLE IF NOT EXISTS "payment_transactions" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT,
  "orderId" TEXT,
  "invoiceId" TEXT,
  "customerId" TEXT,
  "gateway" TEXT NOT NULL,
  "merchantOrderId" TEXT NOT NULL,
  "gatewayOrderId" TEXT,
  "gatewayPaymentId" TEXT,
  "gatewayTransactionId" TEXT,
  "amount" DECIMAL(10,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "status" TEXT NOT NULL DEFAULT 'created',
  "idempotencyKeyHash" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "rawGatewayResponse" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_transactions_merchantOrderId_key" ON "payment_transactions"("merchantOrderId");
CREATE INDEX IF NOT EXISTS "payment_transactions_paymentId_idx" ON "payment_transactions"("paymentId");
CREATE INDEX IF NOT EXISTS "payment_transactions_orderId_idx" ON "payment_transactions"("orderId");
CREATE INDEX IF NOT EXISTS "payment_transactions_invoiceId_idx" ON "payment_transactions"("invoiceId");
CREATE INDEX IF NOT EXISTS "payment_transactions_customerId_idx" ON "payment_transactions"("customerId");
CREATE INDEX IF NOT EXISTS "payment_transactions_gateway_status_createdAt_idx" ON "payment_transactions"("gateway", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "payment_transactions_idempotencyKeyHash_idx" ON "payment_transactions"("idempotencyKeyHash");

CREATE TABLE IF NOT EXISTS "gateway_logs" (
  "id" TEXT NOT NULL,
  "gateway" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "requestId" TEXT,
  "merchantOrderId" TEXT,
  "paymentId" TEXT,
  "safeMessage" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gateway_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "gateway_logs_gateway_status_createdAt_idx" ON "gateway_logs"("gateway", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "gateway_logs_merchantOrderId_idx" ON "gateway_logs"("merchantOrderId");
CREATE INDEX IF NOT EXISTS "gateway_logs_paymentId_idx" ON "gateway_logs"("paymentId");

CREATE TABLE IF NOT EXISTS "webhook_logs" (
  "id" TEXT NOT NULL,
  "gateway" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT,
  "rawBodyHash" TEXT NOT NULL,
  "signatureValid" BOOLEAN,
  "status" TEXT NOT NULL DEFAULT 'received',
  "requestHost" TEXT,
  "payload" JSONB,
  "errorMessage" TEXT,
  "processedAt" TIMESTAMP(3),
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "webhook_logs_gateway_eventId_key" ON "webhook_logs"("gateway", "eventId");
CREATE INDEX IF NOT EXISTS "webhook_logs_gateway_status_createdAt_idx" ON "webhook_logs"("gateway", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "webhook_logs_rawBodyHash_idx" ON "webhook_logs"("rawBodyHash");

CREATE TABLE IF NOT EXISTS "gateway_health_logs" (
  "id" TEXT NOT NULL,
  "gateway" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "latencyMs" INTEGER,
  "checkedUrl" TEXT,
  "safeMessage" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gateway_health_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "gateway_health_logs_gateway_status_createdAt_idx" ON "gateway_health_logs"("gateway", "status", "createdAt");
