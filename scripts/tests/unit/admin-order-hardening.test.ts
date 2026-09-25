import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { calculateAdminOrderPreview, normalizeAdminProvisioningMode } from "@/lib/admin-order-preview"

function read(path: string) {
  return readFileSync(path, "utf8")
}

test("admin order preview normalizes provision modes", () => {
  assert.equal(normalizeAdminProvisioningMode("create_new_vm"), "auto_provision")
  assert.equal(normalizeAdminProvisioningMode("linked"), "link_existing_vm")
  assert.equal(normalizeAdminProvisioningMode("external"), "external_vm_attachment")
  assert.equal(normalizeAdminProvisioningMode("manual"), "manual_provision_complete")
})

test("admin order preview includes add-ons, quantity, discount, and GST", () => {
  const product = {
    id: "product_1",
    name: "Cloud 2",
    cpuCores: 2,
    ramGb: 4,
    storageGb: 80,
    bandwidthTb: 2,
    price1m: 1000,
    backupEnabled: true,
    backupPrice: 100,
    backupStorageGb: 20,
    snapshotEnabled: true,
    snapshotPrice: 50,
    snapshotIncludedCount: 1,
    extraIpv4Price: 75,
  }
  const preview = calculateAdminOrderPreview({
    provisioningMode: "auto_provision",
    product,
    termMonths: 1,
    quantity: 10,
    discountAmount: 500,
    backupEnabled: true,
    snapshotCount: 3,
    ipv4Count: 2,
  })
  assert.equal(preview.unitPrice, 1275)
  assert.equal(preview.pricing.subtotal, 12750)
  assert.equal(preview.pricing.automaticBulkDiscount, 1275)
  assert.equal(preview.pricing.manualDiscount, 500)
  assert.equal(preview.pricing.discountAmount, 1775)
  assert.equal(preview.pricing.taxAmount, 1975.5)
  assert.equal(preview.pricing.totalAmount, 12950.5)
  assert.equal(preview.resourceSummary.cpu, 2)
  assert.equal(preview.resourceSummary.snapshots, 3)
  assert.equal(preview.resourceSummary.additionalIps, 1)
})

test("manual and external services force single-service pricing and resources from admin input", () => {
  const product = { id: "p", name: "Base", cpuCores: 1, ramGb: 1, storageGb: 20, bandwidthTb: 1, price1m: 500 }
  const preview = calculateAdminOrderPreview({
    provisioningMode: "external_vm_attachment",
    product,
    quantity: 20,
    external: { cpu: 8, ramGb: 16, diskGb: 250, bandwidthTb: 5, hostname: "ext-1", operatingSystem: "Ubuntu", externalVmId: "convoy-100" },
  })
  assert.equal(preview.quantity, 1)
  assert.equal(preview.resourceSummary.cpu, 8)
  assert.equal(preview.resourceSummary.ramGb, 16)
  assert.equal(preview.configSummary.externalVmId, "convoy-100")
})

test("schema and migrations support Proxmox-free services", () => {
  const schema = read("prisma/schema.prisma")
  const migration = read("prisma/migrations/20260614_external_manual_services/migration.sql")
  assert.match(schema, /vmid\s+Int\s+@default\(0\)/)
  assert.match(schema, /serviceProvider\s+String\?/)
  assert.match(schema, /externalVmId\s+String\?/)
  assert.match(schema, /serviceLocation\s+String\?/)
  assert.match(schema, /bandwidthTb\s+Decimal\?/)
  assert.match(migration, /ALTER COLUMN "vmid" SET DEFAULT 0/)
  assert.match(migration, /"vps_instances_serviceProvider_externalVmId_idx"/)
})

test("order APIs expose preview and direct service creation paths", () => {
  const previewRoute = read("app/api/admin/orders/preview/route.ts")
  const ordersRoute = read("app/api/admin/orders/route.ts")
  assert.match(previewRoute, /calculateAdminOrderPreview/)
  assert.match(ordersRoute, /external_vm_attachment/)
  assert.match(ordersRoute, /manual_provision_complete/)
  assert.match(ordersRoute, /createDirectVpsService/)
  assert.match(ordersRoute, /noProxmoxRequired/)
  assert.match(ordersRoute, /pricingSnapshot/)
})

test("external and manual services are gated from Proxmox power/actions", () => {
  const control = read("lib/vm-action-jobs.ts")
  const adminVm = read("lib/admin-vm-management.ts")
  const clientPage = read("app/client-area/vps/[id]/page.tsx")
  assert.match(control, /ownershipStatus: \{ notIn: \["external", "manual", "rejected"\] \}/)
  assert.match(adminVm, /mark_provision_complete/)
  assert.match(adminVm, /convert_to_external_vm/)
  assert.match(adminVm, /send_welcome_email/)
  assert.match(clientPage, /proxmoxActionsAvailable/)
})
