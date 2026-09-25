ALTER TABLE "system_security_settings"
  ADD COLUMN IF NOT EXISTS "turnstile_mode" TEXT NOT NULL DEFAULT 'managed',
  ADD COLUMN IF NOT EXISTS "protect_login" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "protect_signup" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "protect_contact" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "protect_checkout" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "protect_tickets" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "last_verification_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_verification_status" TEXT;
