ALTER TABLE "payment_gateways"
  ADD COLUMN IF NOT EXISTS "circuit_opened_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_health_checked_at" TIMESTAMP(3);

ALTER TABLE "payment_retry_queue"
  ADD COLUMN IF NOT EXISTS "held_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "held_by" TEXT,
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT,
  ADD COLUMN IF NOT EXISTS "last_error_code" TEXT,
  ADD COLUMN IF NOT EXISTS "operation" TEXT NOT NULL DEFAULT 'verify';

ALTER TABLE "payment_transactions"
  ADD COLUMN IF NOT EXISTS "authorization_state" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS "authorized_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "gateway_config_id" TEXT,
  ADD COLUMN IF NOT EXISTS "obligation_key" TEXT,
  ADD COLUMN IF NOT EXISTS "settled_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS "payment_outbox_events" (
  "id" TEXT PRIMARY KEY,
  "event_type" TEXT NOT NULL,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL UNIQUE,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMP(3),
  "locked_by" TEXT,
  "processed_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "accounting_accounts" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "accounting_journals" (
  "id" TEXT PRIMARY KEY,
  "event_type" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL UNIQUE,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "effective_at" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'posted',
  "memo" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "reversal_of_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "accounting_entries" (
  "id" TEXT PRIMARY KEY,
  "journal_id" TEXT NOT NULL REFERENCES "accounting_journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "account_id" TEXT NOT NULL REFERENCES "accounting_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "direction" TEXT NOT NULL CHECK ("direction" IN ('debit', 'credit')),
  "amount" DECIMAL(14,2) NOT NULL CHECK ("amount" > 0),
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "gateway_settlements" (
  "id" TEXT PRIMARY KEY,
  "gateway" TEXT NOT NULL,
  "settlement_reference" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "gross_amount" DECIMAL(14,2) NOT NULL,
  "fee_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "net_amount" DECIMAL(14,2) NOT NULL,
  "settled_at" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "source_hash" TEXT NOT NULL UNIQUE,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  UNIQUE ("gateway", "settlement_reference")
);

CREATE TABLE IF NOT EXISTS "manual_payment_requests" (
  "id" TEXT PRIMARY KEY,
  "invoice_id" TEXT NOT NULL,
  "payment_id" TEXT,
  "transaction_reference" TEXT NOT NULL UNIQUE,
  "method" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL CHECK ("amount" > 0),
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "paid_at" TIMESTAMP(3) NOT NULL,
  "evidence" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_approval',
  "requested_by" TEXT NOT NULL,
  "approved_by" TEXT,
  "approved_at" TIMESTAMP(3),
  "rejection_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CHECK ("approved_by" IS NULL OR lower("approved_by") <> lower("requested_by"))
);

CREATE TABLE IF NOT EXISTS "payment_diagnostic_runs" (
  "id" TEXT PRIMARY KEY,
  "trigger" TEXT NOT NULL DEFAULT 'admin',
  "requested_by" TEXT,
  "status" TEXT NOT NULL DEFAULT 'running',
  "summary" JSONB NOT NULL DEFAULT '{}',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "payment_diagnostic_checks" (
  "id" TEXT PRIMARY KEY,
  "run_id" TEXT NOT NULL REFERENCES "payment_diagnostic_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "gateway" TEXT,
  "check" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "latency_ms" INTEGER,
  "code" TEXT,
  "safe_message" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_retry_queue_idempotency_key_key" ON "payment_retry_queue"("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_transactions_obligation_key_key" ON "payment_transactions"("obligation_key");
CREATE INDEX IF NOT EXISTS "payment_transactions_authorization_state_status_idx" ON "payment_transactions"("authorization_state", "status");
CREATE INDEX IF NOT EXISTS "payment_outbox_events_status_available_at_idx" ON "payment_outbox_events"("status", "available_at");
CREATE INDEX IF NOT EXISTS "payment_outbox_events_aggregate_type_aggregate_id_idx" ON "payment_outbox_events"("aggregate_type", "aggregate_id");
CREATE INDEX IF NOT EXISTS "accounting_accounts_type_active_idx" ON "accounting_accounts"("type", "active");
CREATE INDEX IF NOT EXISTS "accounting_journals_source_type_source_id_idx" ON "accounting_journals"("source_type", "source_id");
CREATE INDEX IF NOT EXISTS "accounting_journals_effective_at_status_idx" ON "accounting_journals"("effective_at", "status");
CREATE INDEX IF NOT EXISTS "accounting_entries_journal_id_idx" ON "accounting_entries"("journal_id");
CREATE INDEX IF NOT EXISTS "accounting_entries_account_id_created_at_idx" ON "accounting_entries"("account_id", "created_at");
CREATE INDEX IF NOT EXISTS "gateway_settlements_gateway_status_settled_at_idx" ON "gateway_settlements"("gateway", "status", "settled_at");
CREATE INDEX IF NOT EXISTS "manual_payment_requests_invoice_id_status_idx" ON "manual_payment_requests"("invoice_id", "status");
CREATE INDEX IF NOT EXISTS "manual_payment_requests_status_created_at_idx" ON "manual_payment_requests"("status", "created_at");
CREATE INDEX IF NOT EXISTS "payment_diagnostic_runs_status_created_at_idx" ON "payment_diagnostic_runs"("status", "created_at");
CREATE INDEX IF NOT EXISTS "payment_diagnostic_checks_gateway_status_created_at_idx" ON "payment_diagnostic_checks"("gateway", "status", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_diagnostic_checks_run_gateway_check_key" ON "payment_diagnostic_checks"("run_id", COALESCE("gateway", ''), "check");
