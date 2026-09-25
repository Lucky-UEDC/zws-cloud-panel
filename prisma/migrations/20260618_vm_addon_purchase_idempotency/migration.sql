ALTER TABLE "vm_addon_purchases"
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "vm_addon_purchases_idempotency_key_key"
  ON "vm_addon_purchases" ("idempotency_key");

CREATE UNIQUE INDEX IF NOT EXISTS "vm_addon_purchases_pending_plan_pool_unique_idx"
  ON "vm_addon_purchases" (
    "customer_id",
    "vps_instance_id",
    "addon_plan_id",
    COALESCE("pool_id", '__none__')
  )
  WHERE lower("status") IN ('pending', 'pending_payment');
