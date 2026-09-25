ALTER TABLE "vps_instances"
  ADD COLUMN IF NOT EXISTS "credentialVerificationStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "credentialVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "credentialVerificationCheckedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "credentialVerificationMessage" TEXT;

CREATE INDEX IF NOT EXISTS "vps_instances_credentialVerificationStatus_idx"
  ON "vps_instances"("credentialVerificationStatus");
