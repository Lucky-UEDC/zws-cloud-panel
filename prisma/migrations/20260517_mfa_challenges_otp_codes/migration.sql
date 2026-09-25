CREATE TABLE IF NOT EXISTS "mfa_challenges" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "user_type" TEXT NOT NULL,
  "challenge_token_hash" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "verified_at" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "mfa_challenges_challenge_token_hash_key"
  ON "mfa_challenges"("challenge_token_hash");

CREATE INDEX IF NOT EXISTS "mfa_challenges_user_type_user_id_method_expires_at_idx"
  ON "mfa_challenges"("user_type", "user_id", "method", "expires_at");

CREATE INDEX IF NOT EXISTS "mfa_challenges_expires_at_verified_idx"
  ON "mfa_challenges"("expires_at", "verified");

CREATE TABLE IF NOT EXISTS "otp_codes" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "user_type" TEXT NOT NULL,
  "otp_hash" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "provider" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "verified_at" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "otp_codes_user_type_user_id_channel_created_at_idx"
  ON "otp_codes"("user_type", "user_id", "channel", "created_at");

CREATE INDEX IF NOT EXISTS "otp_codes_expires_at_verified_idx"
  ON "otp_codes"("expires_at", "verified");
