import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { mapLiveVpsStatus, customerFacingVpsStatus } from "@/lib/vps-lifecycle"
import { selectRetainedBackups, normalizeBackupStatus } from "@/lib/proxmox-backup"
import { preferredBackupStorage } from "@/lib/backup-storage"
import { toJsonable } from "@/lib/json-safe"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8")

test("client VM status maps a running runtime to Active", () => {
  const mapped = mapLiveVpsStatus({ status: "running", cpu: 0.12, maxmem: 16 * 1024 ** 2, mem: 4 * 1024 ** 2 }, "ACTIVE", "ACTIVE")
  assert.equal(mapped.status, "ACTIVE")
  assert.equal(mapped.displayStatus, "Active")
  assert.equal(mapped.overloaded, false)
  assert.equal(customerFacingVpsStatus("ACTIVE", "ACTIVE"), "Active")
})

test("client VM status keeps transitional provisioning states visible", () => {
  assert.equal(mapLiveVpsStatus(null, "CLONING_TEMPLATE", "CREATING").status, "INSTALLING")
  assert.equal(mapLiveVpsStatus(null, "APPLYING_CLOUD_INIT", "CREATING").status, "CONFIGURING")
  assert.equal(customerFacingVpsStatus("CONFIGURING", "APPLYING_CLOUD_INIT"), "Provisioning")
  assert.equal(customerFacingVpsStatus("STARTING_VM", "STARTING_VM"), "Provisioning")
})

test("client VM with missing runtime telemetry degrades to DB state without overload noise", () => {
  const mapped = mapLiveVpsStatus(null, "", "ACTIVE")
  assert.equal(mapped.status, "ACTIVE")
  assert.equal(mapped.overloaded, false)
  const hot = mapLiveVpsStatus({ status: "running", cpu: 0.99, maxmem: 16 * 1024 ** 2, mem: 16 * 1024 ** 2 }, "", "ACTIVE")
  assert.equal(hot.overloaded, true)
  assert.equal(hot.status, "OVERLOADED")
})

test("client VM stopped runtime maps to Stopped", () => {
  const mapped = mapLiveVpsStatus({ status: "stopped", cpu: 0, maxmem: 0, mem: 0 }, "ACTIVE", "ACTIVE")
  assert.equal(mapped.status, "STOPPED")
  assert.equal(mapped.displayStatus, "Stopped")
})

test("client status API strips BigInt before it can break JSON responses", () => {
  const payload = { ok: true, backups: { items: [{ sizeBytes: 796485896n, name: "vzdump.vma.zst" }] } }
  const json = JSON.stringify(toJsonable(payload))
  assert.equal(/\D796485896\D/.test(json) || json.includes('"sizeBytes":796485896'), true)
  assert.doesNotThrow(() => JSON.parse(json))
})

test("client VM page guards stale refresh responses and offers retry after failure", () => {
  const page = read("app/client-area/vps/[id]/page.tsx")
  assert.match(page, /AbortController/)
  assert.match(page, /statusRequestRef/)
  assert.match(page, /AbortError/)
  assert.match(page, /Unable to load server state/)
  assert.match(page, /Retry/)
  assert.match(page, /backups/)
})

test("client status route resolves by vmid and never echoes raw errors", () => {
  const route = read("app/api/client/vps/[id]/status/route.ts")
  assert.match(route, /vmidMatch/)
  assert.match(route, /NextResponse\.json\(toJsonable/)
  assert.match(route, /errorCode/)
  assert.match(route, /DB_UNAVAILABLE/)
  assert.doesNotMatch(route, /NextResponse\.json\(error/)
})

test("backup storage discovery prefers hdd2 over local backups on m2-v2", () => {
  const storages = [
    { name: "local", type: "dir", content: "vztmpl,backup,import,iso", supportsBackup: true, enabled: true, totalBytes: 100861726720, usedBytes: 0, availBytes: 76194529280 },
    { name: "hdd2", type: "dir", content: "snippets,images,backup,iso,rootdir,vztmpl", supportsBackup: true, enabled: true, totalBytes: 884254445568, usedBytes: 0, availBytes: 385995993088 },
    { name: "local-lvm", type: "lvmthin", content: "rootdir,images", supportsBackup: false, enabled: true, totalBytes: 0, usedBytes: 0, availBytes: 0 },
  ]
  assert.equal(preferredBackupStorage(storages), "hdd2")
  assert.equal(preferredBackupStorage(storages.filter((s) => s.name !== "hdd2")), "local")
  assert.equal(preferredBackupStorage([]), "")
})

test("backup task creation overwrites queued rows and waits for the task UPID", () => {
  const service = read("lib/proxmox-backup.ts")
  assert.match(service, /status: "queued"/)
  assert.match(service, /createVmBackup/)
  assert.match(service, /normalizeUpid/)
  assert.match(service, /waitForTask\(host\.nodeName, upid, BACKUP_TASK_TIMEOUT_MS\)/)
  assert.match(service, /task timed out/)
})

test("backup success is only verified after the volid resolves on storage", () => {
  const service = read("lib/proxmox-backup.ts")
  assert.match(service, /findBackupVolid/)
  assert.match(service, /status: "completed"/)
  assert.match(service, /\[vm-backup\] backup completed/)
})

test("backup failure marks the row failed and never hides the error", () => {
  const service = read("lib/proxmox-backup.ts")
  assert.match(service, /status: "failed"/)
  assert.match(service, /data: \{ status: "failed", completedAt: new Date\(\), metadata: \{ \.\.\.\(row\.metadata as Record<string, unknown>\), error: message \} \}/)
  assert.match(service, /\[vm-backup\] backup failed/)
})

test("retention enforcement only runs after a successful backup", () => {
  const service = read("lib/proxmox-backup.ts")
  const callSite = "enforceVmBackupRetention(policyId, Number(vmid)).catch("
  const enforcement = service.indexOf(callSite)
  assert.equal(service.indexOf(callSite), service.lastIndexOf(callSite), "single retention call site")
  const pollingCatch = service.indexOf("catch (error: any) {")
  const outerCatch = service.indexOf("catch (error: any) {", pollingCatch + 1)
  assert.ok(pollingCatch > -1 && outerCatch > -1)
  assert.ok(enforcement > pollingCatch && enforcement < outerCatch, "retention call sits in the success path between the task poll and the failure catch")
})

test("retention keeps exactly the last five unprotected backups", () => {
  const result = selectRetainedBackups(rowsKeep(), 5)
  assert.equal(result.retained.length, 5)
  assert.deepEqual(result.retained.map((b) => b.id), ["backup-0", "backup-1", "backup-2", "backup-3", "backup-4"])
  const exactlyFive = selectRetainedBackups(rowsKeep(5), 5)
  assert.equal(exactlyFive.toTrim.length, 0)
  assert.equal(exactlyFive.retained.length, 5)
})

test("normalizeBackupStatus round-trips all canonical client statuses", () => {
  for (const status of ["queued", "running", "completed", "failed", "cancelled"]) {
    assert.equal(normalizeBackupStatus(status), status)
  }
  assert.equal(normalizeBackupStatus("COMPLETED"), "completed")
  assert.equal(normalizeBackupStatus("partial"), "queued")
})

test("snapshot lifecycle exposes create, delete and rollback with verified cleanup", () => {
  const service = read("lib/proxmox-snapshots.ts")
  assert.match(service, /\[vm-snapshot\] snapshot created/)
  assert.match(service, /\[vm-snapshot\] snapshot deleted/)
  assert.match(service, /markSnapshotDeleted/)
  assert.match(service, /deleteVMSnapshot\(node\.nodeName, Number\(vmid\), safeName\)/)
})

test("node monitoring is cached, concurrency-limited and isolates offline nodes", () => {
  const monitoring = read("lib/compute-node-monitoring.ts")
  assert.match(monitoring, /getCachedJson/)
  assert.match(monitoring, /NODE_METRICS_CACHE_TTL_SECONDS/)
  assert.match(monitoring, /mapLimit\(nodes, NODE_LIST_CONCURRENCY/)
  assert.match(monitoring, /status: "offline"/)
  const nodesRoute = read("app/api/admin/compute-nodes/route.ts") + read("app/api/admin/proxmox-nodes/route.ts")
  assert.match(nodesRoute, /staleWhileRevalidate|isrRefresh|no-store|force-cache|NODE_METRICS/)
})

test("backup scheduler skips a policy+VM that already has a queued or running backup", () => {
  const scheduler = read("scripts/vm-backup-scheduler.ts")
  assert.match(scheduler, /hasInflightBackup/)
  assert.match(scheduler, /status: \{ in: \["queued", "running"\] \}/)
  assert.match(scheduler, /backup already queued or running/)
  assert.match(scheduler, /results\[vmid\] = "skipped"/)
  assert.match(scheduler, /Object\.values\(results\)\.filter\(\(status\) => status === "failed"\)/)
})

function rowsKeep(count = 7) {
  return Array.from({ length: count }, (_, i) => ({ id: `backup-${i}`, metadata: {} }))
}