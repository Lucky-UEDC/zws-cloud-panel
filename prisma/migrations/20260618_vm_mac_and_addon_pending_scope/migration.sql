ALTER TABLE "vps_instances"
  ADD COLUMN IF NOT EXISTS "vm_mac_address" TEXT;

UPDATE "vps_instances" v
SET "vm_mac_address" = iface."macAddress"
FROM "vm_network_interfaces" iface
WHERE iface."vpsInstanceId" = v.id
  AND iface."macAddress" IS NOT NULL
  AND trim(iface."macAddress") <> ''
  AND (v."vm_mac_address" IS NULL OR trim(v."vm_mac_address") = '')
  AND (iface."isPrimary" = true OR iface.name = 'net0');

DROP INDEX IF EXISTS "vm_addon_purchases_pending_unique_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "vm_addon_purchases_pending_plan_pool_unique_idx"
  ON "vm_addon_purchases" (
    "customer_id",
    "vps_instance_id",
    "addon_plan_id",
    COALESCE("pool_id", '__none__')
  )
  WHERE lower("status") IN ('pending', 'pending_payment');
