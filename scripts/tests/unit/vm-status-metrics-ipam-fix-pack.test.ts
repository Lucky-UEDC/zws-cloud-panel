import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { configuredMemoryBytes, parseLinuxDfBytes, parseWindowsVolumes } from "@/lib/vm-guest-disk"
import { dbStatusFromPowerState, normalizeProxmoxPowerState, VM_STATUS_CACHE_TTL_MS } from "@/lib/vm-runtime-status"
import { hostnameFromIp } from "@/lib/vm-hostname"
import { legacyGuestAgentCommand, legacyGuestAgentCommandParams } from "@/lib/proxmox"
import { ipPoolNodeEligibility } from "@/lib/ip-pool"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8")

test("VM status helper maps Proxmox power states and enforces 30 second cache TTL", () => {
  assert.equal(VM_STATUS_CACHE_TTL_MS, 30_000)
  assert.equal(normalizeProxmoxPowerState("running"), "running")
  assert.equal(normalizeProxmoxPowerState("stopped"), "stopped")
  assert.equal(normalizeProxmoxPowerState("paused"), "paused")
  assert.equal(normalizeProxmoxPowerState("suspended"), "suspended")
  assert.equal(dbStatusFromPowerState("running"), "ACTIVE")
  assert.equal(dbStatusFromPowerState("stopped"), "STOPPED")
  assert.equal(dbStatusFromPowerState("paused"), "PAUSED")
  assert.equal(dbStatusFromPowerState("suspended"), "SUSPENDED")
})

test("configured VM memory is used for RAM totals", () => {
  assert.equal(configuredMemoryBytes({ memory: 16384 }, 18_000_000_000), 17_179_869_184)
  assert.equal(configuredMemoryBytes({}, 1024), 1024)
})

test("guest disk parsers handle Linux and Windows outputs", () => {
  const linux = parseLinuxDfBytes("Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/sda1 200000000000 44000000000 156000000000 22% /\n")
  assert.equal(linux.ok, true)
  assert.equal(linux.totalBytes, 200_000_000_000)
  assert.equal(linux.usedBytes, 44_000_000_000)
  assert.equal(linux.freeBytes, 156_000_000_000)

  const windowsJson = parseWindowsVolumes(JSON.stringify([
    { DriveLetter: "C", DriveType: 3, SizeRemaining: 156000000000, Size: 200000000000, FileSystem: "NTFS" },
    { DriveLetter: "D", DriveType: 3, SizeRemaining: 400000000000, Size: 500000000000, FileSystem: "NTFS" },
  ]))
  // Totals describe the selected system drive (C:), not the sum of every volume.
  assert.equal(windowsJson.ok, true)
  assert.equal(windowsJson.totalBytes, 200_000_000_000)
  assert.equal(windowsJson.usedBytes, 44_000_000_000)
  assert.equal(windowsJson.freeBytes, 156_000_000_000)
  assert.equal(windowsJson.selectedVolume?.name, "C:")
  assert.equal(windowsJson.volumes.length, 2)

  const windowsWmic = parseWindowsVolumes("DeviceID=C:\r\nFreeSpace=32100000000\r\nSize=49900000000\r\n\r\nDeviceID=D:\r\nFreeSpace=10000000000\r\nSize=20000000000\r\n\r\n")
  assert.equal(windowsWmic.ok, true)
  assert.equal(windowsWmic.totalBytes, 49_900_000_000)
  assert.equal(windowsWmic.usedBytes, 17_800_000_000)
  assert.equal(windowsWmic.freeBytes, 32_100_000_000)
  assert.equal(windowsWmic.volumes.length, 2)
})

test("legacy guest-agent command fallback matches qm guest exec argv text", () => {
  assert.equal(legacyGuestAgentCommand(["df", "-B1", "/"]), "df -B1 /")
  assert.equal(legacyGuestAgentCommand(["wmic", "logicaldisk", "get", "DeviceID,Size,FreeSpace", "/format:list"]), "wmic logicaldisk get DeviceID,Size,FreeSpace /format:list")
  assert.doesNotMatch(legacyGuestAgentCommand(["df", "-B1", "/"]), /'/)
  assert.equal(legacyGuestAgentCommandParams(["df", "-B1", "/"]), "command=df&command=-B1&command=%2F")
  assert.equal(legacyGuestAgentCommandParams(["wmic", "logicaldisk", "get", "DeviceID,Size,FreeSpace", "/format:list"]), "command=wmic&command=logicaldisk&command=get&command=DeviceID%2CSize%2CFreeSpace&command=%2Fformat%3Alist")
})

test("schema and migration expose production fix-pack fields", () => {
  const schema = read("prisma/schema.prisma")
  const migrationValidation = read("scripts/validate-migrations.ts")
  assert.match(schema, /instanceName\s+String\?\s+@map\("instance_name"\)/)
  assert.match(schema, /hostname\s+String\?/)
  assert.match(schema, /poolType\s+String\s+@default\("NORMAL"\)\s+@map\("pool_type"\)/)
  assert.match(schema, /model VmUsageHistory/)
  assert.match(schema, /@@map\("vm_usage_history"\)/)
  assert.match(schema, /diskFreeBytes\s+BigInt\s+@default\(0\)\s+@map\("disk_free_bytes"\)/)
  assert.match(migrationValidation, /20260619_vm_status_metrics_disk_ip_hostname/)
  assert.match(schema, /poolNodeAssignments/)
})

test("IPAM and addon paths use canonical node assignments and customer masking", () => {
  const ipPool = read("lib/ip-pool.ts")
  const addons = read("lib/vm-addons.ts")
  const changePrimary = read("lib/vm-network-orchestrator.ts")
  const routeCrawler = read("scripts/production-route-crawler.ts")
  assert.match(ipPool, /poolNodeAssignments\?\.find/)
  assert.match(ipPool, /export function isGlobalIpPool/)
  assert.match(ipPool, /export function isAddonOnlyIpPool/)
  assert.match(ipPool, /export function ipPoolNodeEligibility/)
  assert.doesNotMatch(ipPool, /nodeAssignments\?\.find\(\(row\) => row\.nodeId === nodeId\)/)
  assert.doesNotMatch(ipPool, /function hasNodeAssignment/)
  assert.doesNotMatch(ipPool, /function findFallbackPools/)
  assert.match(ipPool, /poolType: \{ not: "ADDON_ONLY" \}/)
  assert.match(addons, /maskedIpLabel/)
  assert.match(addons, /ipPoolNodeEligibility\(\{ pool, nodeId, purpose: "addon" \}\)/)
  assert.match(addons, /purpose: "addon"/)
  assert.match(addons, /rangeLabel: maskedIpLabel/)
  assert.match(addons, /\.filter\(\(option: any\) => option\?\.available\)/)
  assert.doesNotMatch(addons, /const nodeOk = Boolean\(nodeId\)/)
  assert.match(changePrimary, /success: blocking\.length === 0/)
  assert.match(changePrimary, /blocking: blocking\.length > 0/)
  assert.match(changePrimary, /POOL_NODE_MISMATCH"\s*\? input\.forceOverride !== true : true/)
  assert.match(changePrimary, /pool_addon_only/)
  assert.match(changePrimary, /duplicate_allocation", message: "Target IP is already allocated to another VM", blocking: true/)
  assert.match(changePrimary, /duplicate_assignment", message: "Target IP is already active on another VM assignment", blocking: true/)
  assert.match(routeCrawler, /"\/admin\/logs"/)
})

test("canonical pool eligibility helper enforces normal, global, and addon-only visibility", () => {
  const normalPool = {
    id: "pool-normal",
    name: "normal",
    startIp: "10.0.0.10",
    endIp: "10.0.0.20",
    isActive: true,
    staticOnly: true,
    poolMode: "NORMAL",
    poolType: "NORMAL",
    poolNodeAssignments: [{ nodeId: "node-a", active: true }],
  }
  assert.equal(ipPoolNodeEligibility({ pool: normalPool, nodeId: "node-a", purpose: "provisioning" }).ok, true)
  const unassigned = ipPoolNodeEligibility({ pool: normalPool, nodeId: "node-b", purpose: "provisioning" })
  assert.equal(unassigned.ok, false)
  assert.equal(unassigned.code, "POOL_NODE_MISMATCH")

  const globalPool = { ...normalPool, id: "pool-global", poolMode: "GLOBAL", poolNodeAssignments: [] }
  assert.equal(ipPoolNodeEligibility({ pool: globalPool, nodeId: "any-node", purpose: "provisioning" }).ok, true)

  const addonPool = { ...normalPool, id: "pool-addon", poolType: "ADDON_ONLY" }
  const provisioning = ipPoolNodeEligibility({ pool: addonPool, nodeId: "node-a", purpose: "provisioning" })
  assert.equal(provisioning.ok, false)
  assert.equal(provisioning.code, "POOL_ADDON_ONLY")
  assert.equal(ipPoolNodeEligibility({ pool: addonPool, nodeId: "node-a", purpose: "addon" }).ok, true)
})

test("reinstall queue completion closes active duplicates and clears dedupe locks", () => {
  const provision = read("lib/provision.ts")
  assert.match(provision, /type: "reinstall", status: \{ in: \["queued", "running", "retrying", "waiting_for_admin"\] \}/)
  assert.match(provision, /displayStatus: "Reinstall complete"/)
  assert.match(provision, /completedAt/)
  assert.match(provision, /dedupeKey: null/)
  assert.match(provision, /Closed after reinstall completion/)
  assert.match(provision, /queue:claimed/)
  assert.match(provision, /queue:stale_recovered/)
  assert.match(provision, /queue:stale_failed/)
})

test("internal hostnames are generated from assigned IPs", () => {
  assert.equal(hostnameFromIp("172.26.9.79"), "ip-172-26-9-79")
  assert.equal(hostnameFromIp("not-an-ip"), null)
  const provision = read("lib/provision.ts")
  assert.match(provision, /hostnameFromIp\(allocation\.ipAddress\)/)
  assert.match(provision, /client\.updateVMConfig\(nodeName, vmid, \{ name: internalHostname \}\)/)
})

test("production UI metrics use 30 second live polling and 5 minute history buckets", () => {
  const worker = read("scripts/vm-telemetry-worker.ts")
  const dbTruth = read("lib/vm-db-truth.ts")
  const smartPolling = read("lib/hooks/use-smart-polling.ts")
  const clientStream = read("app/api/client/vps/[id]/live/stream/route.ts")
  assert.match(worker, /VM_TELEMETRY_POLL_MS \|\| 30_000/)
  assert.match(worker, /const stopped = runtimeStatus === "stopped"/)
  assert.match(dbTruth, /function bucketMetricPoints\(rows: any\[\], bucketMs = 5 \* 60_000\)/)
  assert.match(smartPolling, /const interval = 30_000/)
  assert.match(clientStream, /refreshOneVmRuntimeStatusById\(resolved\.id, customerId, \{ force: true \}\)/)
})
