ALTER TABLE "ip_pools"
  ADD COLUMN IF NOT EXISTS "pool_type" TEXT NOT NULL DEFAULT 'NORMAL';

CREATE INDEX IF NOT EXISTS "ip_pools_pool_type_idx" ON "ip_pools"("pool_type");

ALTER TABLE "vps_metrics"
  ADD COLUMN IF NOT EXISTS "disk_free_bytes" BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "cloudflare_accounts" (
  "id" TEXT PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "account_name" TEXT,
  "zone_id" TEXT,
  "zone_name" TEXT,
  "tunnel_id" TEXT,
  "tunnel_name" TEXT,
  "access_token_encrypted" TEXT NOT NULL,
  "refresh_token_encrypted" TEXT,
  "token_expires_at" TIMESTAMP(3),
  "scope" TEXT,
  "status" TEXT NOT NULL DEFAULT 'connected',
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "connected_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "cloudflare_accounts_account_id_key" ON "cloudflare_accounts"("account_id");
CREATE INDEX IF NOT EXISTS "cloudflare_accounts_status_is_active_idx" ON "cloudflare_accounts"("status", "is_active");
CREATE INDEX IF NOT EXISTS "cloudflare_accounts_zone_id_idx" ON "cloudflare_accounts"("zone_id");
CREATE INDEX IF NOT EXISTS "cloudflare_accounts_tunnel_id_idx" ON "cloudflare_accounts"("tunnel_id");

CREATE TABLE IF NOT EXISTS "cloudflare_oauth_states" (
  "state" TEXT PRIMARY KEY,
  "code_verifier_encrypted" TEXT,
  "redirect_uri" TEXT NOT NULL,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "cloudflare_oauth_states_expires_at_idx" ON "cloudflare_oauth_states"("expires_at");
