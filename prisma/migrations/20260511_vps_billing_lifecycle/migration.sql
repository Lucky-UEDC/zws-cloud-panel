ALTER TABLE "vps_instances"
  ADD COLUMN IF NOT EXISTS "billingTermMonths" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "activatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "renewalDueAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspendAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "penaltyAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "terminationAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletionAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "graceDays" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "penaltyPercent" DECIMAL(5,2) NOT NULL DEFAULT 10.00,
  ADD COLUMN IF NOT EXISTS "suspensionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "manualExpiryOverride" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "manualCreatedDateOverride" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "createdAtManual" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "activatedAtManual" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "renewalAtManual" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspendAtManual" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "terminationAtManual" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletionAtManual" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "editedByAdminId" TEXT,
  ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "editReason" TEXT,
  ADD COLUMN IF NOT EXISTS "lastReminderSentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastReminderLevel" TEXT,
  ADD COLUMN IF NOT EXISTS "autoSuspendEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "autoDeleteEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "retentionDays" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS "penaltyAppliedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "automationPausedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "remindersPausedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lifecycleMetadata" JSONB NOT NULL DEFAULT '{}';

UPDATE "vps_instances"
SET
  "renewalDueAt" = COALESCE("renewalDueAt", "nextRenewalAt"),
  "activatedAt" = COALESCE("activatedAt", "createdAt"),
  "billingTermMonths" = CASE
    WHEN lower(COALESCE("billingCycle", 'monthly')) IN ('annual', 'yearly') THEN 12
    ELSE COALESCE(NULLIF("billingTermMonths", 0), 1)
  END,
  "suspendAt" = CASE
    WHEN "suspendAt" IS NULL AND COALESCE("renewalDueAt", "nextRenewalAt") IS NOT NULL
      THEN COALESCE("renewalDueAt", "nextRenewalAt") + (COALESCE(NULLIF("graceDays", 0), 2) * INTERVAL '1 day')
    ELSE "suspendAt"
  END,
  "penaltyAt" = CASE
    WHEN "penaltyAt" IS NULL AND COALESCE("renewalDueAt", "nextRenewalAt") IS NOT NULL
      THEN COALESCE("renewalDueAt", "nextRenewalAt") + (COALESCE(NULLIF("graceDays", 0), 2) * INTERVAL '1 day')
    ELSE "penaltyAt"
  END,
  "deletionAt" = CASE
    WHEN "deletionAt" IS NULL AND "suspendedAt" IS NOT NULL
      THEN "suspendedAt" + (COALESCE(NULLIF("retentionDays", 0), 7) * INTERVAL '1 day')
    ELSE "deletionAt"
  END
WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "vps_instances_renewalDueAt_status_idx" ON "vps_instances"("renewalDueAt", "status");
CREATE INDEX IF NOT EXISTS "vps_instances_suspendAt_status_idx" ON "vps_instances"("suspendAt", "status");
CREATE INDEX IF NOT EXISTS "vps_instances_penaltyAt_status_idx" ON "vps_instances"("penaltyAt", "status");
CREATE INDEX IF NOT EXISTS "vps_instances_deletionAt_status_idx" ON "vps_instances"("deletionAt", "status");
CREATE INDEX IF NOT EXISTS "vps_instances_autoSuspendEnabled_autoDeleteEnabled_idx" ON "vps_instances"("autoSuspendEnabled", "autoDeleteEnabled");
CREATE INDEX IF NOT EXISTS "vps_instances_editedByAdminId_idx" ON "vps_instances"("editedByAdminId");

ALTER TABLE "dedicated_services"
  ADD COLUMN IF NOT EXISTS "createdAtManual" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "activatedAtManual" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "renewalAtManual" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspendAtManual" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "terminationAtManual" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletionAtManual" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "editedByAdminId" TEXT,
  ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "editReason" TEXT;

CREATE INDEX IF NOT EXISTS "dedicated_services_editedByAdminId_idx" ON "dedicated_services"("editedByAdminId");
