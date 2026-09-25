CREATE INDEX IF NOT EXISTS "vps_instances_customerId_deletedAt_status_idx"
  ON "vps_instances"("customerId", "deletedAt", "status");

CREATE INDEX IF NOT EXISTS "vps_instances_customerId_orderId_idx"
  ON "vps_instances"("customerId", "orderId");

CREATE INDEX IF NOT EXISTS "vps_instances_proxmoxNodeId_vmid_idx"
  ON "vps_instances"("proxmoxNodeId", "vmid");

CREATE INDEX IF NOT EXISTS "invoices_vpsInstanceId_status_createdAt_idx"
  ON "invoices" ((metadata->>'vpsInstanceId'), "status", "createdAt");
