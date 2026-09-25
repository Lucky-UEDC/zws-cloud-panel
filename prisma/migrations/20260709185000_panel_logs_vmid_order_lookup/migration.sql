CREATE INDEX CONCURRENTLY IF NOT EXISTS "panel_logs_vmid_order_id_lookup_idx"
  ON "panel_logs"("vmid", "orderId")
  WHERE "orderId" IS NOT NULL;
