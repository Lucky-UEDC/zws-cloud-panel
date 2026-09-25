ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "assuranceLevel" TEXT NOT NULL DEFAULT 'FULLY_AUTHENTICATED',
  ADD COLUMN IF NOT EXISTS "mfaVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deviceFingerprint" TEXT;

CREATE INDEX IF NOT EXISTS "sessions_assuranceLevel_idx" ON "sessions"("assuranceLevel");
CREATE INDEX IF NOT EXISTS "sessions_mfaVerifiedAt_idx" ON "sessions"("mfaVerifiedAt");
