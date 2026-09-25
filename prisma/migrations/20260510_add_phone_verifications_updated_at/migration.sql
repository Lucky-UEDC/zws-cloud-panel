CREATE TABLE IF NOT EXISTS "phone_verifications" (
  "id" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "countryCode" TEXT NOT NULL,
  "otpHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "ip" TEXT,
  "userAgent" TEXT,
  "verificationToken" TEXT,
  "whatsappMessageId" TEXT,
  "deliveryStatus" TEXT NOT NULL DEFAULT 'queued',
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "phone_verifications_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "phone_verifications"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "phone_verifications_verificationToken_key" ON "phone_verifications"("verificationToken");
CREATE INDEX IF NOT EXISTS "phone_verifications_phone_createdAt_idx" ON "phone_verifications"("phone", "createdAt");
CREATE INDEX IF NOT EXISTS "phone_verifications_countryCode_idx" ON "phone_verifications"("countryCode");
CREATE INDEX IF NOT EXISTS "phone_verifications_expiresAt_idx" ON "phone_verifications"("expiresAt");
CREATE INDEX IF NOT EXISTS "phone_verifications_deliveryStatus_idx" ON "phone_verifications"("deliveryStatus");
CREATE INDEX IF NOT EXISTS "phone_verifications_verifiedAt_idx" ON "phone_verifications"("verifiedAt");
