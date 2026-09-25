import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function read(path: string) {
  return readFileSync(path, "utf8")
}

test("link existing VM requires live Proxmox preview success before order creation", () => {
  const page = read("app/admin/orders/new/page.tsx")
  const previewRoute = read("app/api/admin/vms/existing/preview/route.ts")
  const management = read("lib/admin-vm-management.ts")
  assert.match(page, /linkedVmReady/)
  assert.match(page, /vmPreview\?\.validation\?\.ok === true/)
  assert.match(page, /Load VM/)
  assert.match(previewRoute, /loadExistingVmPreview/)
  assert.match(management, /client\.getVMStatus/)
  assert.match(management, /client\.getVMConfig/)
  assert.match(management, /VM already assigned/)
})

test("manual and automatic VM migration use node and VM identity notes", () => {
  const page = read("components/admin/vms/admin-vms-client.tsx")
  const manualRoute = read("app/api/admin/vms/[id]/reassign/route.ts")
  const autoRoute = read("app/api/admin/vms/[id]/reassign/auto/route.ts")
  const management = read("lib/admin-vm-management.ts")
  assert.match(page, /Auto/)
  assert.match(page, /Current VMID/)
  assert.match(manualRoute, /reassignVmMapping/)
  assert.match(autoRoute, /autoFindVmForService/)
  assert.match(management, /extractMetadataFromNotes/)
  assert.match(management, /scoreIdentityMatch/)
  assert.match(management, /applyVmidNodeSync/)
})

test("drained nodes remain monitored but cannot receive new placements", () => {
  const schema = read("prisma/schema.prisma")
  const migration = read("prisma/migrations/20260711210000_payment_capture_node_drain/migration.sql")
  const placement = read("lib/provisioning-placement.ts")
  const telemetry = read("scripts/node-telemetry-worker.ts")
  assert.match(schema, /schedulingEnabled\s+Boolean\s+@default\(true\)/)
  assert.match(migration, /Chandigarh1/)
  assert.match(placement, /schedulingEnabled: true/)
  assert.match(telemetry, /where: \{ isActive: true \}/)
})

test("node telemetry persists live heartbeats without a node-health cache", () => {
  const telemetry = read("lib/node-telemetry.ts")
  assert.match(telemetry, /NODE_METRIC_PERSIST_MS/)
  assert.doesNotMatch(telemetry, /LIVE_SNAPSHOT_TTL_SECONDS/)
  assert.doesNotMatch(telemetry, /zws:node:\$\{node\.id\}:live/)
  assert.match(telemetry, /nodeMetric\.findFirst/)
  assert.match(telemetry, /meaningfulChange/)
})

test("admin node monitoring returns explicit offline state instead of stale cache data", () => {
  const monitoring = read("lib/compute-node-monitoring.ts")
  assert.doesNotMatch(monitoring, /monitoringCache/)
  assert.doesNotMatch(monitoring, /showing cached data/)
  assert.match(monitoring, /status: "offline" as const/)
})
