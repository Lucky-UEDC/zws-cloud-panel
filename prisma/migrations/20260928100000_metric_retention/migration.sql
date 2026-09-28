-- Metric retention tiers.
--
-- Additive only. Every column is nullable or defaulted, so every existing row
-- stays valid and counts as a raw sample whose bucket is its `created_at`. No
-- backfill, no rewrite of existing history.
--
-- Why: raw samples are taken roughly every thirty seconds per VM. At that rate a
-- hundred servers writes a hundred rows every thirty seconds for a year, which
-- is the kind of table that eventually takes down the database it lives in.
-- Retention folds them into 5m rows after seven days and 1h rows after thirty,
-- which answers "is it full right now", "was it full last Tuesday" and "was it
-- full last March" at the resolution each question actually needs.
--
-- The unique index is what makes a downsampling pass idempotent: a pass that is
-- interrupted and re-run cannot double-count a bucket it already wrote.

ALTER TABLE "vm_usage_history" ADD COLUMN IF NOT EXISTS "vps_instance_id" TEXT;
ALTER TABLE "vm_usage_history" ADD COLUMN IF NOT EXISTS "resolution" TEXT NOT NULL DEFAULT 'raw';
ALTER TABLE "vm_usage_history" ADD COLUMN IF NOT EXISTS "recorded_at" TIMESTAMP(3);
ALTER TABLE "vm_usage_history" ADD COLUMN IF NOT EXISTS "disk_free" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "vm_usage_history" ADD COLUMN IF NOT EXISTS "sample_count" INTEGER NOT NULL DEFAULT 1;

-- Existing rows are raw samples; their bucket is the time they were written.
UPDATE "vm_usage_history"
SET "recorded_at" = "created_at", "resolution" = 'raw'
WHERE "recorded_at" IS NULL;

CREATE INDEX IF NOT EXISTS "vm_usage_history_vps_instance_id_resolution_recorded_at_idx"
  ON "vm_usage_history"("vps_instance_id", "resolution", "recorded_at");

-- The retention sweep scans by resolution and time, never by VM.
CREATE INDEX IF NOT EXISTS "vm_usage_history_resolution_recorded_at_idx"
  ON "vm_usage_history"("resolution", "recorded_at");

-- Idempotency for the downsampler. NULLs are excluded so pre-migration rows,
-- which have no vps_instance_id, do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS "vm_usage_history_bucket_key"
  ON "vm_usage_history"("vps_instance_id", "resolution", "recorded_at")
  WHERE "vps_instance_id" IS NOT NULL AND "recorded_at" IS NOT NULL;

-- Guest disk samples are retained on the same schedule. The index is what makes
-- the sweep cheap; without it, deleting a week of samples is a sequential scan
-- of the largest table in the system.
CREATE INDEX IF NOT EXISTS "guest_disk_samples_vps_instance_id_recorded_at_idx"
  ON "guest_disk_samples"("vps_instance_id", "recorded_at");
