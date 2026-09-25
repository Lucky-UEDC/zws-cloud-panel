-- Managed Proxmox VMs can outlive their customer order rows. Preserve the
-- discovered ORDER_ID as incident evidence without recreating customer data.
ALTER TABLE "duplicate_vm_incidents"
  DROP CONSTRAINT IF EXISTS "duplicate_vm_incidents_order_id_fkey";
