import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"

const read = (path: string) => fs.readFileSync(path, "utf8")

test("power actions are durable node and VMID jobs without cloud-init or IP gates", () => {
  const jobs = read("lib/vm-action-jobs.ts")
  const control = read("lib/vps-control.ts")
  assert.match(jobs, /vmActionJob\.create/)
  assert.match(jobs, /client\.startVM\(job\.nodeName, job\.vmid\)/)
  assert.match(jobs, /graceful: false/)
  assert.match(jobs, /graceful: true/)
  const actionBody = control.slice(control.indexOf("export async function performVpsPowerAction"))
  assert.doesNotMatch(actionBody, /selfHealBeforeStart|assigned_ip|cloud_init|getVMStatus/)
  assert.match(actionBody, /enqueueVmAction/)
})

test("role-aware public action and polling APIs return accepted jobs", () => {
  const actionRoute = read("app/api/vm/[action]/route.ts")
  const jobRoute = read("app/api/vm/jobs/[jobId]/route.ts")
  assert.match(actionRoute, /resolveVmActionTargetByNode/)
  assert.match(actionRoute, /status: 202/)
  assert.match(actionRoute, /getAdminFromRequest/)
  assert.match(actionRoute, /getClientFromRequest/)
  assert.match(jobRoute, /customerId/)
  assert.match(jobRoute, /serializeVmActionJob/)
})

test("admin VM details render diagnostic states instead of uncaught 500s", () => {
  const page = read("app/admin/vms/[id]/page.tsx")
  const management = read("lib/admin-vm-management.ts")
  assert.match(page, /Unable to load VM details/)
  assert.match(page, /RelationDiagnostics/)
  assert.match(page, /ADMIN_VM_DETAILS_FATAL/)
  assert.match(management, /fatalVmDetailsResult/)
  assert.match(management, /getVpsForAdminDetails/)
  assert.match(management, /VM_NOT_FOUND/)
  assert.match(management, /relations/)
  assert.match(management, /recoverableErrors/)
})

test("VM action and runtime refresh paths avoid unsafe relation assertions", () => {
  const actionRoute = read("app/api/vm/[action]/route.ts")
  const runtimeStatus = read("lib/vm-runtime-status.ts")
  const jobs = read("lib/vm-action-jobs.ts")
  assert.doesNotMatch(actionRoute, /admin!|proxmoxNode!/)
  assert.doesNotMatch(runtimeStatus, /vps!|proxmoxNode!/)
  assert.match(runtimeStatus, /vm_not_found/)
  assert.match(runtimeStatus, /node_unavailable/)
  assert.match(runtimeStatus, /proxmox_unavailable/)
  assert.match(jobs, /VM_ACTION_NODE_MISSING/)
  assert.match(jobs, /VM_ACTION_VPS_MISSING/)
})

test("reconciliation inventories Proxmox and quarantines ambiguous identity", () => {
  const source = read("lib/production-vps-reconciliation.ts")
  assert.match(source, /getVMList/)
  assert.match(source, /parseVmIdentityTags/)
  assert.match(source, /VmReconciliationIncident|vmReconciliationIncident/)
  assert.match(source, /ORPHAN_VM/)
  assert.match(source, /DUPLICATE_IP/)
  assert.doesNotMatch(source.slice(source.indexOf("const inventory"), source.indexOf("for \(const vps of vpsRows")), /config\?\.name|hostname/)
})

test("reinstall exposes persisted milestones and order customer search is server-side", () => {
  const provision = read("lib/provision.ts")
  const orderPage = read("app/admin/orders/new/page.tsx")
  const customers = read("app/api/admin/customers/route.ts")
  for (const step of ["REINSTALL_PREPARING", "REINSTALL_STOPPING", "REINSTALL_ASSIGN_IP", "REINSTALL_CONFIGURE_DNS", "REINSTALL_CLOUD_INIT", "REINSTALL_WAIT_AGENT", "REINSTALL_HEALTH_CHECKS", "REINSTALL_TEST_ACCESS", "REINSTALL_READY"]) {
    assert.match(provision, new RegExp(step))
  }
  assert.match(orderPage, /CustomerSearch/)
  assert.match(orderPage, /pageSize.*50/)
  assert.match(customers, /phoneNumber/)
  assert.match(customers, /mode: "insensitive"/)
})
