CREATE TABLE IF NOT EXISTS "domain_configs" (
  "id" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "brandName" TEXT,
  "appBaseUrl" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "canonicalRedirectEnabled" BOOLEAN NOT NULL DEFAULT false,
  "allowedGatewayModes" JSONB NOT NULL DEFAULT '[]',
  "defaultGateway" TEXT,
  "fallbackGateway" TEXT,
  "environmentMode" TEXT NOT NULL DEFAULT 'production',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "domain_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "domain_gateway_configs" (
  "id" TEXT NOT NULL,
  "domainId" TEXT NOT NULL,
  "gateway" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "environment" TEXT NOT NULL DEFAULT 'production',
  "displayName" TEXT,
  "approvedPaymentDomain" TEXT,
  "webhookUrl" TEXT,
  "returnUrl" TEXT,
  "startUrl" TEXT,
  "credentialsEnc" TEXT,
  "credentialsIv" TEXT,
  "credentialsTag" TEXT,
  "extraConfig" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "domain_gateway_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "payment_attempts" (
  "id" TEXT NOT NULL,
  "orderId" TEXT,
  "invoiceId" TEXT,
  "paymentId" TEXT,
  "userId" TEXT,
  "gateway" TEXT NOT NULL,
  "domainId" TEXT,
  "gatewayConfigId" TEXT,
  "sourceDomain" TEXT,
  "approvedDomain" TEXT,
  "merchantOrderId" TEXT NOT NULL,
  "gatewayPaymentId" TEXT,
  "amount" NUMERIC(10,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "status" TEXT NOT NULL DEFAULT 'created',
  "mode" TEXT NOT NULL DEFAULT 'direct',
  "redirectUrl" TEXT,
  "bridgeUrl" TEXT,
  "returnUrl" TEXT,
  "webhookVerifiedAt" TIMESTAMP(3),
  "statusCheckedAt" TIMESTAMP(3),
  "rawGatewayResponse" JSONB,
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "payment_bridge_tokens" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "paymentAttemptId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_bridge_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "domain_configs_domain_key" ON "domain_configs"("domain");
CREATE INDEX IF NOT EXISTS "domain_configs_isPrimary_idx" ON "domain_configs"("isPrimary");
CREATE INDEX IF NOT EXISTS "domain_configs_isActive_idx" ON "domain_configs"("isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "domain_gateway_configs_domainId_gateway_environment_key" ON "domain_gateway_configs"("domainId", "gateway", "environment");
CREATE INDEX IF NOT EXISTS "domain_gateway_configs_gateway_enabled_idx" ON "domain_gateway_configs"("gateway", "enabled");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_attempts_merchantOrderId_key" ON "payment_attempts"("merchantOrderId");
CREATE INDEX IF NOT EXISTS "payment_attempts_orderId_idx" ON "payment_attempts"("orderId");
CREATE INDEX IF NOT EXISTS "payment_attempts_invoiceId_idx" ON "payment_attempts"("invoiceId");
CREATE INDEX IF NOT EXISTS "payment_attempts_paymentId_idx" ON "payment_attempts"("paymentId");
CREATE INDEX IF NOT EXISTS "payment_attempts_gateway_status_idx" ON "payment_attempts"("gateway", "status");
CREATE INDEX IF NOT EXISTS "payment_attempts_sourceDomain_idx" ON "payment_attempts"("sourceDomain");
CREATE INDEX IF NOT EXISTS "payment_attempts_approvedDomain_idx" ON "payment_attempts"("approvedDomain");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_bridge_tokens_tokenHash_key" ON "payment_bridge_tokens"("tokenHash");
CREATE INDEX IF NOT EXISTS "payment_bridge_tokens_paymentAttemptId_idx" ON "payment_bridge_tokens"("paymentAttemptId");
CREATE INDEX IF NOT EXISTS "payment_bridge_tokens_expiresAt_idx" ON "payment_bridge_tokens"("expiresAt");

DO $$ BEGIN
  ALTER TABLE "domain_gateway_configs" ADD CONSTRAINT "domain_gateway_configs_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "domain_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "domain_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_gatewayConfigId_fkey" FOREIGN KEY ("gatewayConfigId") REFERENCES "domain_gateway_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "payment_bridge_tokens" ADD CONSTRAINT "payment_bridge_tokens_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "payment_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO "domain_configs" ("id", "domain", "displayName", "brandName", "appBaseUrl", "isPrimary", "isActive", "canonicalRedirectEnabled", "allowedGatewayModes", "defaultGateway", "fallbackGateway", "environmentMode", "metadata", "notes")
VALUES
  ('domain_freerdp_in', 'freerdp.in', 'ZWS Cloud', 'ZWS Cloud', 'https://freerdp.in', true, true, false, '["cashfree","phonepe","manual","wallet"]', 'cashfree', NULL, 'production', '{}', 'Single Cloudflare Tunnel production domain.')
ON CONFLICT ("domain") DO NOTHING;

INSERT INTO "domain_gateway_configs" ("id", "domainId", "gateway", "enabled", "priority", "environment", "displayName", "approvedPaymentDomain", "webhookUrl", "returnUrl", "startUrl", "extraConfig")
VALUES
  ('gateway_freerdp_cashfree_prod', 'domain_freerdp_in', 'cashfree', true, 10, 'production', 'Cashfree', 'freerdp.in', 'https://freerdp.in/api/webhooks/cashfree', 'https://freerdp.in/payment/status?order_id={order_id}', NULL, '{}'),
  ('gateway_freerdp_phonepe_prod', 'domain_freerdp_in', 'phonepe', true, 20, 'production', 'PhonePe', 'freerdp.in', 'https://freerdp.in/api/webhooks/phonepe', 'https://freerdp.in/payment/status?order_id={order_id}', NULL, '{}')
ON CONFLICT ("domainId", "gateway", "environment") DO NOTHING;
