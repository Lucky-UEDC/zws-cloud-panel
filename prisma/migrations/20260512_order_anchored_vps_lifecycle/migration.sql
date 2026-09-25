ALTER TABLE "vps_instances"
  ADD COLUMN IF NOT EXISTS "penaltyWindowDays" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "terminationWindowDays" INTEGER NOT NULL DEFAULT 7;

UPDATE "vps_instances" v
SET
  "renewalDueAt" = COALESCE(v."renewalAtManual", o."createdAt" + (GREATEST(COALESCE(o."termMonths", v."billingTermMonths", 1), 1) || ' months')::interval),
  "nextRenewalAt" = COALESCE(v."renewalAtManual", o."createdAt" + (GREATEST(COALESCE(o."termMonths", v."billingTermMonths", 1), 1) || ' months')::interval),
  "suspendAt" = COALESCE(v."suspendAtManual", o."createdAt" + (GREATEST(COALESCE(o."termMonths", v."billingTermMonths", 1), 1) || ' months')::interval + (GREATEST(COALESCE(v."graceDays", 2), 0) || ' days')::interval),
  "penaltyAt" = o."createdAt" + (GREATEST(COALESCE(o."termMonths", v."billingTermMonths", 1), 1) || ' months')::interval + ((GREATEST(COALESCE(v."graceDays", 2), 0) + GREATEST(COALESCE(v."penaltyWindowDays", 1), 0)) || ' days')::interval,
  "terminationAt" = COALESCE(v."terminationAtManual", o."createdAt" + (GREATEST(COALESCE(o."termMonths", v."billingTermMonths", 1), 1) || ' months')::interval + ((GREATEST(COALESCE(v."graceDays", 2), 0) + GREATEST(COALESCE(v."penaltyWindowDays", 1), 0) + GREATEST(COALESCE(v."terminationWindowDays", 7), 0)) || ' days')::interval),
  "deletionAt" = COALESCE(v."deletionAtManual", o."createdAt" + (GREATEST(COALESCE(o."termMonths", v."billingTermMonths", 1), 1) || ' months')::interval + ((GREATEST(COALESCE(v."graceDays", 2), 0) + GREATEST(COALESCE(v."penaltyWindowDays", 1), 0) + GREATEST(COALESCE(v."terminationWindowDays", 7), 0) + GREATEST(COALESCE(v."retentionDays", 7), 1)) || ' days')::interval)
FROM "orders" o
WHERE v."orderId" = o."id"
  AND COALESCE(v."manualExpiryOverride", false) = false;
