ALTER TABLE "phone_verifications" ADD COLUMN IF NOT EXISTS "otpCorrelationId" TEXT;

CREATE INDEX IF NOT EXISTS "phone_verifications_otpCorrelationId_idx" ON "phone_verifications"("otpCorrelationId");
