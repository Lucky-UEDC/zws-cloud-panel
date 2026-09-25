import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { buildVmNotes, extractMetadataFromNotes } from "@/lib/proxmox-tags"
import { scoreIdentityMatch } from "@/lib/admin-vm-management"

function read(path: string) {
  return readFileSync(path, "utf8")
}

test("VM identity notes write and parse canonical migration-safe keys", () => {
  const notes = buildVmNotes({
    orderId: "order_123",
    customerId: "customer_789",
    vmUuid: "service_456",
    productId: "product_1",
  })
  assert.match(notes, /ZWS_ORDER=order_123/)
  assert.match(notes, /ZWS_SERVICE=service_456/)
  assert.match(notes, /ZWS_CUSTOMER=customer_789/)
  assert.match(notes, /ZWS_EMAIL=-/)
  assert.match(notes, /ZWS_UUID=service_456/)
  assert.match(notes, /UUID=service_456/)

  const parsed = extractMetadataFromNotes(notes)
  assert.equal(parsed.orderId, "order_123")
  assert.equal((parsed as any).serviceId, "service_456")
  assert.equal(parsed.customerId, "customer_789")
  assert.equal(parsed.vmUuid, "service_456")
})

test("identity match priority follows uuid, order, service, customer", () => {
  const base = { orderId: "order_123", serviceId: "service_456", customerId: "customer_789" }
  assert.equal(scoreIdentityMatch({ ...base, notes: extractMetadataFromNotes("ZWS_UUID=service_456\nZWS_ORDER=order_123\nZWS_SERVICE=other") }).method, "uuid")
  assert.equal(scoreIdentityMatch({ ...base, notes: extractMetadataFromNotes("ZWS_ORDER=order_123\nZWS_SERVICE=other\nZWS_CUSTOMER=other\nUUID=other") }).method, "order_id")
  assert.equal(scoreIdentityMatch({ ...base, notes: extractMetadataFromNotes("ZWS_SERVICE=service_456\nZWS_CUSTOMER=customer_789") }).method, "service_id")
  assert.equal(scoreIdentityMatch({ ...base, notes: extractMetadataFromNotes("ZWS_CUSTOMER=customer_789") }).method, "customer_id")
})

test("schema prevents duplicate active node/vmid mappings and stores provision mode", () => {
  const schema = read("prisma/schema.prisma")
  const migration = read("prisma/migrations/20260614_existing_vm_linking/migration.sql")
  assert.match(schema, /provisionMode\s+String\s+@default\("created"\)/)
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "vps_instances_active_node_vmid_unique"/)
  assert.match(migration, /WHERE "deletedAt" IS NULL/)
})

test("linked order creation binds without invoking paid provisioning finalization", () => {
  const route = read("app/api/admin/orders/route.ts")
  assert.match(route, /provisioningMode/)
  assert.match(route, /bindExistingVmToOrder/)
  assert.match(route, /purpose: "admin_link_existing_vm"/)
  assert.match(route, /linkedServiceCreatedAt/)
  assert.match(route, /linkedServiceDueAt/)
  assert.match(route, /preview\.validation\?\.ok/)
  assert.match(route, /Unpaid|request_payment|status: "paid"/)
  assert.match(route, /continue/)
})

test("existing VM preview exposes hard validation checks and exact operator errors", () => {
  const source = read("lib/admin-vm-management.ts")
  for (const text of ["Node Reachable", "VM Found", "VM Accessible", "VM Not Assigned", "VM not found", "Node unreachable", "VM already assigned", "VM locked", "VM configuration unavailable", "VM pending deletion"]) {
    assert.match(source, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  }
  assert.match(source, /vmDeletionJob\.findFirst/)
  assert.match(source, /validation:\s*{[\s\S]*ok:/)
})

test("admin linked order form requires successful preview and carries test dates", () => {
  const page = read("app/admin/orders/new/page.tsx")
  assert.match(page, /linkedVmReady/)
  assert.match(page, /vmPreview\?\.validation\?\.ok === true/)
  assert.match(page, /todayIso\(\)/)
  assert.match(page, /futureIso\(30\)/)
  assert.match(page, /Current Notes/)
  assert.match(page, /validation\?\.checks/)
})

test("linked and manual-delivery sources remain managed for telemetry and Proxmox actions", () => {
  for (const path of [
    "scripts/live-bandwidth-worker.ts",
    "scripts/vm-telemetry-worker.ts",
    "app/api/admin/proxmox/vms/route.ts",
    "app/api/admin/proxmox/vms/[vmid]/action/route.ts",
    "app/api/admin/proxmox/vms/[vmid]/status/route.ts",
  ]) {
    const source = read(path)
    assert.match(source, /linked/)
    assert.match(source, /manual_delivery/)
  }
})
