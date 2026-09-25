-- Align live database with the schema/db-check expectation while preserving
-- the existing functional unique index created by the gateway migration.

CREATE UNIQUE INDEX IF NOT EXISTS "payment_diagnostic_checks_run_id_gateway_check_key"
  ON "payment_diagnostic_checks"("run_id", "gateway", "check");
