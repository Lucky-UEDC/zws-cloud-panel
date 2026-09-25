import { readFileSync } from "node:fs"
import { test } from "node:test"
import assert from "node:assert/strict"

function read(path: string) {
  return readFileSync(path, "utf8")
}

test("generateVmHostnames accepts optional ips parameter", () => {
  const src = read("lib/order-bulk.ts")
  assert.match(src, /ips\?: string\[\]/, "ips param must be in type signature")
  assert.match(src, /hostnameFromIp/, "must call hostnameFromIp when ips provided")
  assert.match(src, /input\.ips\?\.length/, "must check ips array length")
})

test("generateVmHostnames falls back to slug format without ips", () => {
  const src = read("lib/order-bulk.ts")
  assert.match(src, /zws\./, "fallback must still produce zws.plan.customer-N format")
})

test("validateCloudInitPreBoot is exported from cloud-init-config", () => {
  const src = read("lib/cloud-init-config.ts")
  assert.match(src, /export function validateCloudInitPreBoot/)
  assert.match(src, /ipconfig0.*ip=.*gw=|ip=.*gw=.*ipconfig0/, "must check ipconfig0 contains ip= and gw=")
  assert.match(src, /missing\.push\("ciuser"\)/)
  assert.match(src, /missing\.push\("cipassword"\)/)
  assert.match(src, /missing\.push\("nameserver"\)/)
  assert.match(src, /missing\.push\("searchdomain"\)/)
  assert.match(src, /missing\.push\("cloudinit_drive"\)/)
})

test("validateCloudInitPreBoot returns ok:false for missing fields", async () => {
  const { validateCloudInitPreBoot } = await import("../../../lib/cloud-init-config.js")
  const result = validateCloudInitPreBoot({})
  assert.equal(result.ok, false)
  assert.ok(result.missing.includes("ipconfig0"))
  assert.ok(result.missing.includes("ciuser"))
  assert.ok(result.missing.includes("cipassword"))
  assert.ok(result.missing.includes("nameserver"))
  assert.ok(result.missing.includes("searchdomain"))
  assert.ok(result.missing.includes("cloudinit_drive"))
})

test("validateCloudInitPreBoot returns ok:true for valid config", async () => {
  const { validateCloudInitPreBoot } = await import("../../../lib/cloud-init-config.js")
  const result = validateCloudInitPreBoot({
    ipconfig0: "ip=10.0.0.5/24,gw=10.0.0.1",
    ciuser: "root",
    cipassword: "secret123",
    nameserver: "1.1.1.1",
    searchdomain: "example.com",
    ide2: "local:cloudinit",
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.missing, [])
})

test("hostnameFromIp produces ip-x-x-x-x format", async () => {
  const { hostnameFromIp } = await import("../../../lib/vm-hostname.js")
  assert.equal(hostnameFromIp("10.0.0.5"), "ip-10-0-0-5")
  assert.equal(hostnameFromIp("192.168.1.100"), "ip-192-168-1-100")
  assert.equal(hostnameFromIp(""), null)
  assert.equal(hostnameFromIp("not-an-ip"), null)
})

test("reinstall lock is acquired via db compare-and-swap", () => {
  const src = read("lib/provision.ts")
  assert.match(src, /acquireReinstallLock/)
  assert.ok(src.includes("updateMany"), "must use updateMany for atomic compare-and-swap")
  assert.ok(src.includes("reinstallLock: false"), "must filter on reinstallLock: false")
  assert.match(src, /updated\.count === 0/)
  assert.match(src, /reinstall_already_locked/)
})

test("reinstall lock guard in client API returns 409", () => {
  const src = read("app/api/client/vps/[id]/reinstall/route.ts")
  assert.match(src, /reinstallLock/)
  assert.match(src, /409/)
})

test("validateReinstallNetwork is exported from vm-network-orchestrator", () => {
  const src = read("lib/vm-network-orchestrator.ts")
  assert.match(src, /export async function validateReinstallNetwork/)
  assert.match(src, /invalid_mac/)
  assert.match(src, /duplicate_ip/)
  assert.match(src, /invalid_bridge/)
})

test("validateReinstallNetwork is called before applyFreshMacBeforeFirstBoot", () => {
  const src = read("lib/provision.ts")
  const networkPos = src.indexOf("validateReinstallNetwork")
  const macPos = src.indexOf("applyFreshMacBeforeFirstBoot")
  assert.ok(networkPos > 0, "validateReinstallNetwork must be called")
  assert.ok(networkPos < macPos, "validateReinstallNetwork must come before applyFreshMacBeforeFirstBoot")
})

test("multi-tier force stop has three tiers", () => {
  const src = read("lib/vm-power-control.ts")
  assert.match(src, /Tier 1|tier 1|tier1/)
  assert.match(src, /Tier 2|tier 2|tier2/)
  assert.match(src, /Tier 3|tier 3|tier3/)
  assert.match(src, /execNodeCommand/)
  assert.doesNotMatch(src, /force_stop_exhausted/)
  assert.match(src, /\/var\/run\/qemu-server\/\$\{vmid\}\.pid/)
})

test("waitForVmDeleted helper exists in provision.ts", () => {
  const src = read("lib/provision.ts")
  assert.match(src, /async function waitForVmDeleted/)
  assert.match(src, /waitForVmDeleted\(client/)
})

test("waitForGuestAgentReady helper exists in provision.ts", () => {
  const src = read("lib/provision.ts")
  assert.match(src, /async function waitForGuestAgentReady/)
  assert.match(src, /waitForGuestAgentReady\(client/)
})

test("schema has reinstall_lock and reinstall_locked_at columns", () => {
  const schema = read("prisma/schema.prisma")
  assert.match(schema, /reinstallLock\s+Boolean\s+@default\(false\)/)
  assert.match(schema, /reinstallLockedAt\s+DateTime\?/)
  assert.match(schema, /reinstall_lock_idx|reinstall_lock/)
})

test("schema has ssh_username and ssh_password on ProxmoxNode", () => {
  const schema = read("prisma/schema.prisma")
  assert.match(schema, /sshUsername\s+String\?/)
  assert.match(schema, /sshPassword\s+String\?/)
})
