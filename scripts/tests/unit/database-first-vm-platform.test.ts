import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function read(path: string) {
  return readFileSync(path, "utf8")
}

test("database-first VM schema exposes exact cache, history, audit, and addon tables", () => {
  const schema = read("prisma/schema.prisma")
  for (const table of [
    "vm_runtime",
    "vm_network",
    "vm_network_cache",
    "vm_metrics_cache",
    "vm_bandwidth_usage",
    "ip_assignments",
    "ip_history",
    "vm_ip_history",
    "vm_addons",
    "vm_snapshots",
    "vm_backups",
    "vm_state_cache",
    "vm_audit_logs",
    "vm_addon_plans",
    "vm_addon_node_prices",
    "vm_addon_pool_prices",
    "vm_addon_purchases",
    "vm_addon_worker_tasks",
  ]) {
    assert.match(schema, new RegExp(`@@map\\("${table}"\\)`))
  }
})

test("VM page-load routes are database-only and do not call Proxmox", () => {
  for (const file of [
    "app/api/client/vps/route.ts",
    "app/api/client/vps/[id]/status/route.ts",
    "app/api/client/vps/[id]/metrics/route.ts",
    "app/api/client/vps/[id]/bandwidth/route.ts",
    "app/api/admin/vms/route.ts",
    "app/api/admin/vms/[id]/route.ts",
    "app/api/admin/vms/live/stream/route.ts",
    "app/api/admin/vms/[id]/live/route.ts",
    "app/api/admin/vms/[id]/live/stream/route.ts",
  ]) {
    const source = read(file)
    assert.doesNotMatch(source, /createProxmoxClient/)
    assert.doesNotMatch(source, /loadLiveVmSnapshot/)
    assert.doesNotMatch(source, /\.getVMStatus\(/)
    assert.doesNotMatch(source, /\.getVMConfig\(/)
    assert.doesNotMatch(source, /discoverVmIpAddress/)
  }
})

test("canonical client IP comes from exact ip_assignments only", () => {
  const source = read("lib/vm-db-truth.ts")
  assert.match(source, /vmNetworkCache\.findMany/)
  assert.match(source, /ipAssignment\.findMany/)
  assert.match(source, /bucket\.primaryIp = primaryAssignment\?\.assignedIp \|\| null/)
  assert.match(source, /networkCacheIp: network\?\.primaryAssignedIp \|\| null/)
  assert.doesNotMatch(source, /primaryIp = .*cloudInit/i)
  assert.doesNotMatch(source, /primaryIp = .*discovered/i)
})

test("Proxmox sync worker delegates to production reconciliation without creating duplicate pools", () => {
  const worker = read("scripts/database-first-proxmox-sync-worker.ts")
  const engine = read("lib/production-vps-reconciliation.ts")
  assert.match(worker, /runProductionVpsReconciliation\(\{/)
  assert.match(worker, /mode: "apply"/)
  assert.match(engine, /extractGuestIpv4Addresses/)
  assert.match(engine, /ipAssignment\.create/)
  assert.match(engine, /findOrderFromEvidence/)
  assert.match(engine, /findCustomerFromEvidence/)
  assert.match(engine, /findProductFromEvidence/)
  assert.match(engine, /createRecoveredOrder/)
  assert.match(engine, /createRecoveredVps/)
  assert.match(engine, /ensureProvisioningIdentity/)
  assert.match(engine, /ipHistory\.create/)
  assert.match(engine, /vmIpAssignment\.create/)
  assert.match(engine, /primaryDns/)
  assert.match(engine, /vmAuditLog\.create/)
  assert.match(engine, /duplicate_ip_conflict/)
  assert.match(engine, /assigned_ip_missing_in_database/)
  assert.match(engine, /PROVISIONING_IDENTITY_REPAIR_FAILED/)
  assert.doesNotMatch(worker, /createProxmoxClient/)
  assert.doesNotMatch(engine, /ipPool\.create/)
  assert.doesNotMatch(engine, /ipPool\.delete/)
  assert.doesNotMatch(engine, /deleteMany\(\{\s*where:\s*\{\s*pool/i)
})

test("database integrity audit scans foreign-key orphans and verifies backups before apply", () => {
  const source = read("scripts/db-integrity-audit.ts")
  assert.match(source, /buildForeignKeyOrphanChecks/)
  assert.match(source, /pg_constraint/)
  assert.match(source, /pg_restore/)
  assert.match(source, /wallet_transactions_missing_customer/)
  assert.match(source, /ssh_keys_missing_customer/)
  assert.match(source, /vm_snapshots_missing_vps/)
  assert.match(source, /vm_backups_missing_vps/)
})

test("customer VPS actions map database repair codes without hiding backend codes", () => {
  const mapper = read("lib/client/database-error.ts")
  const detail = read("app/client-area/vps/[id]/page.tsx")
  const list = read("app/client-area/vps/page.tsx")
  assert.match(mapper, /assigned_ip_missing_in_database/)
  assert.match(mapper, /assigned_ip_dns_missing_in_database/)
  assert.match(mapper, /automatic repair is queued/)
  assert.match(detail, /customerDatabaseRepairMessage\(data\)/)
  assert.match(list, /customerDatabaseRepairMessage\(data\)/)
  assert.doesNotMatch(detail, /throw new Error\(data\.error \|\| "Action failed"\)/)
  assert.doesNotMatch(list, /throw new Error\(data\.error \|\| "Action failed"\)/)
})

test("VM start queues node and VMID work without Cloud-Init or IP gates", () => {
  const source = read("lib/vm-action-jobs.ts")
  const control = read("lib/vps-control.ts")
  assert.match(source, /client\.startVM\(job\.nodeName, job\.vmid\)/)
  assert.match(control, /enqueueVmAction/)
  const actionBody = control.slice(control.indexOf("export async function performVpsPowerAction"))
  assert.doesNotMatch(actionBody, /selfHealBeforeStart|assigned_ip|cloud_init|getVMStatus/)
})

test("addon purchase creates entitlement, audit, and worker task after verified payment", () => {
  const source = read("lib/vm-addons.ts")
  assert.match(source, /paymentVerified/)
  assert.match(source, /Addon payment must be verified/)
  assert.match(source, /vmAddonPurchase\.create/)
  assert.match(source, /vmAddon\.create/)
  assert.match(source, /vmAddonWorkerTask\.create/)
  assert.match(source, /vmAuditLog\.create/)
})

test("addon purchase path is idempotent and requires IP pool selection", () => {
  const source = read("lib/vm-addons.ts")
  const route = read("app/api/client/vps/[id]/addons/route.ts")
  const schema = read("prisma/schema.prisma")
  assert.match(schema, /idempotencyKey\s+String\?\s+@map\("idempotency_key"\)/)
  assert.match(read("prisma/migrations/20260618_vm_addon_purchase_idempotency/migration.sql"), /vm_addon_purchases_pending_plan_pool_unique_idx/)
  assert.match(source, /PENDING_PURCHASE_STATUSES/)
  assert.match(source, /withRedisLock\(`lock:\$\{lockScope\}`/)
  assert.match(source, /acquireAddonPurchaseDbLock/)
  assert.match(source, /\$executeRaw`SELECT pg_advisory_xact_lock\(hashtext\(\$\{scope\}\)\)`/)
  assert.match(source, /const concurrentByKey = await \(tx as any\)\.vmAddonPurchase\.findUnique/)
  assert.match(source, /const concurrentPending = await \(tx as any\)\.vmAddonPurchase\.findFirst/)
  assert.match(source, /findUnique\(\{\s*where:\s*\{\s*idempotencyKey/)
  assert.match(source, /reusedExisting/)
  assert.match(source, /Select an IP pool before buying this addon/)
  assert.match(source, /reservation/)
  assert.match(source, /releaseExpiredAddonReservations/)
  assert.match(source, /addonPlanId: selected\.id/)
  assert.match(source, /poolId: selectedPoolKey/)
  assert.match(route, /idempotencyKey/)
  assert.match(route, /poolId/)
})

test("VM MAC and addon lifecycle contracts are exposed", () => {
  const schema = read("prisma/schema.prisma")
  const provision = read("lib/provision.ts")
  const truth = read("lib/vm-db-truth.ts")
  const adminQuery = read("lib/admin-vm-query.ts")
  const clientPage = read("app/client-area/vps/[id]/page.tsx")
  assert.match(schema, /vmMacAddress\s+String\?\s+@map\("vm_mac_address"\)/)
  assert.match(read("prisma/migrations/20260618_vm_mac_and_addon_pending_scope/migration.sql"), /vm_mac_address/)
  assert.match(provision, /vmMacAddress: hardGate\.macAddress \|\| generatedMacAddress/)
  assert.match(truth, /macAddress: vps\.vmMacAddress \|\| canonical\.macAddress/)
  assert.match(adminQuery, /macAddress/)
  assert.match(clientPage, /proxmoxActionsAvailable/)
  assert.match(read("lib/vm-addons.ts"), /removeVmAddon/)
  assert.match(read("lib/vm-addons.ts"), /Additional IPv4 is permanent and cannot be removed/)
})

test("additional IPv4 is recurring and addon notifications are separated", () => {
  const renewals = read("lib/renewals.ts")
  const addons = read("lib/vm-addons.ts")
  const registry = read("lib/whatsapp/template-registry.ts")
  const templates = read("lib/whatsapp/templates.ts")
  const adminEdit = read("app/api/admin/vms/[id]/edit/route.ts")
  assert.match(renewals, /recurringAddonRenewalLines/)
  assert.match(renewals, /type: "additional_ipv4"/)
  assert.match(renewals, /vmAddon\.updateMany\(\{\s*where: \{ vpsInstanceId: vps\.id, addonType: "ip", status: "active" \}/)
  assert.match(addons, /Additional IPv4 is permanent and cannot be removed/)
  assert.match(addons, /ADDITIONAL_IP_ACTIVATED/)
  assert.match(addons, /BANDWIDTH_ADDON_ACTIVATED/)
  assert.match(addons, /SNAPSHOT_ADDON_ACTIVATED/)
  assert.match(addons, /BACKUP_ADDON_ACTIVATED/)
  assert.match(registry, /ADDITIONAL_IP_ACTIVATED/)
  assert.match(templates, /Additional IP Activated/)
  assert.match(adminEdit, /cpuCores/)
  assert.match(adminEdit, /macAddress/)
  // Guest-owned fields are applied by guest automation, not by writing
  // ci*/ipconfig0 into the VM config.
  assert.match(adminEdit, /GuestAutomationService/)
  // No Cloud-Init key is ever written. `cipassword` may still appear in the
  // config-diff redaction below, which is a read, not a write.
  assert.doesNotMatch(adminEdit, /proxmoxPatch\.ciuser/)
  assert.doesNotMatch(adminEdit, /proxmoxPatch\.cipassword/)
  assert.doesNotMatch(adminEdit, /proxmoxPatch\.ipconfig0/)
  assert.doesNotMatch(adminEdit, /proxmoxPatch\.nameserver/)
  assert.doesNotMatch(adminEdit, /updateCloudInit/)
})

test("provisioning hard gate validates MAC, guest agent, guest-reported network and reachability before ACTIVE", () => {
  const source = read("lib/provision.ts")
  const control = read("lib/vps-control.ts")
  assert.match(source, /generateFreshMacAddress/)
  assert.match(source, /applyFreshMacBeforeFirstBoot/)
  assert.match(source, /verifyProvisioningHardGate/)
  assert.match(source, /macFresh/)
  // The gate is now built on what the guest reports, not on what was injected
  // into the Proxmox config.
  assert.match(source, /guestAgentOnline/)
  assert.match(source, /guestIpApplied/)
  assert.match(source, /guestGatewayApplied/)
  assert.match(source, /guestDnsApplied/)
  assert.match(source, /networkReachable/)
  assert.match(source, /isProvisioningValidationFailure/)
  assert.match(source, /provisioning_hard_gate_failed/)
  assert.match(source, /const mappedStatus: "START_FAILED" \| "FAILED"/)
  assert.match(source, /status: "failed"/)
  assert.doesNotMatch(source, /mappedStatus === "ACTIVE" \|\| mappedStatus === "STOPPED"/)
  assert.ok(source.indexOf("verifyProvisioningHardGate({") < source.indexOf("status: mappedStatus"), "hard gate must run before ACTIVE service update")
  // The pre-start guard no longer rewrites anything; it checks and records.
  assert.match(control, /ensureGuestCredentials/)
  assert.match(control, /ensureGuestBeforeStartAction/)
  assert.doesNotMatch(control, /updateCloudInit/)
  assert.doesNotMatch(control, /ipconfig0\s*=/)
  assert.doesNotMatch(control, /cipassword\s*=/)
})
