ALTER TABLE "payment_attempts"
  ADD COLUMN IF NOT EXISTS "capture_status" TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS "capture_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "capture_claimed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "captured_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "capture_last_error" TEXT;

CREATE INDEX IF NOT EXISTS "payment_attempts_gateway_capture_status_capture_claimed_at_idx"
  ON "payment_attempts"("gateway", "capture_status", "capture_claimed_at");

ALTER TABLE "proxmox_nodes"
  ADD COLUMN IF NOT EXISTS "scheduling_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "drain_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "drained_at" TIMESTAMP(3);

UPDATE "proxmox_nodes"
SET
  "scheduling_enabled" = false,
  "drain_reason" = 'Capacity drain: RAM utilization exceeded the production placement threshold',
  "drained_at" = COALESCE("drained_at", CURRENT_TIMESTAMP)
WHERE lower("name") = lower('Chandigarh1')
  AND "scheduling_enabled" = true;
