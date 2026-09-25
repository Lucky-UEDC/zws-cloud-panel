import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { PROVISION_PHASES } from "@/lib/provisioning-identity"
import { buildVmNotes, extractMetadataFromNotes } from "@/lib/proxmox-tags"
import { selectPrimaryDuplicateVm } from "@/lib/vm-duplicate-quarantine"

function read(path: string) { return readFileSync(path, "utf8") }

test("canonical provisioning state machine is complete and ordered", () => {
  assert.deepEqual(PROVISION_PHASES, ["NEW", "LOCKED", "CLONING", "CONFIGURING", "RESIZING", "SETTING_NETWORK", "STARTING", "WAITING_GUEST_AGENT", "READY", "FAILED"])
})

test("canonical Proxmox notes carry recovery identity and legacy keys", () => {
  const notes = buildVmNotes({ orderId: "order-1", customerId: "customer-1", vmUuid: "vps-1", vmid: 213, ip: "203.0.113.10", mac: "02:00:00:00:00:01", createdAt: "2026-07-02T00:00:00Z" })
  for (const value of ["ORDER_ID=order-1", "CUSTOMER_ID=customer-1", "SERVICE_ID=vps-1", "VM_UUID=vps-1", "VMID=213", "IP=203.0.113.10", "MAC=02:00:00:00:00:01", "CREATED_AT=2026-07-02 00:00 UTC", "ZWS_ORDER=order-1"]) assert.match(notes, new RegExp(value))
  const parsed = extractMetadataFromNotes(notes)
  assert.equal(parsed.orderId, "order-1")
  assert.equal(parsed.vmid, 213)
  assert.equal(parsed.ip, "203.0.113.10")
})

test("duplicate primary selection prefers DB mapping then newest healthy VM", () => {
  const base: any = { client: {}, config: {}, notes: {}, name: "vm", ip: null, mac: null }
  const oldLinked = { ...base, node: { id: "n1" }, vmid: 203, status: "stopped", createdAt: new Date("2026-07-02T01:00:00Z") }
  const newer = { ...base, node: { id: "n1" }, vmid: 219, status: "running", createdAt: new Date("2026-07-02T02:00:00Z") }
  assert.equal(selectPrimaryDuplicateVm([oldLinked, newer], { proxmoxNodeId: "n1", vmid: 203 }).primary.vmid, 203)
  assert.equal(selectPrimaryDuplicateVm([oldLinked, newer], null).primary.vmid, 219)
})

test("database and worker source enforce one identity, global VMID and order lease", () => {
  const schema = read("prisma/schema.prisma")
  const migration = read("prisma/migrations/20260702000000_one_order_one_vm/migration.sql")
  const provision = read("lib/provision.ts")
  assert.match(schema, /model VmProvisioningIdentity/)
  assert.match(schema, /orderId\s+String\s+@unique/)
  assert.match(schema, /vmid\s+Int\?\s+@unique/)
  assert.match(migration, /vps_instances_active_global_vmid_unique/)
  assert.match(migration, /vps_instances_active_public_ip_unique/)
  assert.match(provision, /lock:order:\$\{orderId\}/)
  assert.match(provision, /recordCloneIntent/)
  assert.match(provision, /clone:timeout_reconciled/)
  assert.match(provision, /ip:retained_for_recovery/)
})

test("missing VM unsuspend queues recovery and force stop has no exhaustion error", () => {
  const admin = read("lib/admin-vm-management.ts")
  const power = read("lib/vm-power-control.ts")
  assert.match(admin, /vm_missing_unsuspend_recovery/)
  assert.match(admin, /RECOVERY_QUEUED/)
  assert.doesNotMatch(power, /force_stop_exhausted/)
  assert.match(power, /qemu-server\/\$\{vmid\}\.pid/)
})

test("Docker health tolerates external TLS and clean periodic exits without hiding scanner errors", () => {
  const health = read("app/api/health/route.ts")
  const supervisor = read("workers/process-supervisor.ts")
  const scheduler = read("workers/zws-scheduler.ts")
  const duplicates = read("lib/vm-duplicate-quarantine.ts")
  assert.match(health, /external_tls_termination/)
  assert.match(supervisor, /healthyWhenCleanlyExited/)
  assert.match(supervisor, /cleanPeriodicExit/)
  assert.match(scheduler, /invoice-cleanup[\s\S]*healthyWhenCleanlyExited: true/)
  assert.match(duplicates, /getVMList\(node\.nodeName\)\.catch/)
  assert.match(duplicates, /if \(!observed\) continue/)
})
