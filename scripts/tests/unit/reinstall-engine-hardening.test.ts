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

test("no reinstall path checks Cloud-Init fields", () => {
  // The reinstall flow used to assert that `ciuser`, `cipassword`, `ipconfig0`,
  // `nameserver` and `searchdomain` were present in the Proxmox config before
  // booting. None of those are written any more, so the check could only ever
  // fail, and the module that implemented it has been deleted.
  // Comments and the two remaining legitimate mentions — disk-key detection that
  // must keep skipping a legacy cloudinit drive, and a legacy error token for
  // jobs already in flight — are allowed. What must not exist is a check for
  // those fields, or a call to a Cloud-Init helper.
  const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  for (const file of ["lib/provision.ts", "lib/vps-control.ts"]) {
    const code = strip(read(file))
    // Word-bounded, so `ciUserForTemplate` (a username picker that merely
    // contains the substring) is not mistaken for the `ciuser` key.
    assert.doesNotMatch(code, /\bciuser\b/, `${file} still handles the ciuser key`)
    assert.doesNotMatch(code, /\bcipassword\b\s*[:=]/, `${file} still writes a cipassword value`)
    // `normalized === "cipassword"` in the redaction list is a read that protects
    // logs. It is the only place the string may appear.
    const redactionOnly = code.match(/cipassword/g) || []
    assert.ok(redactionOnly.length <= 1, `${file} refers to cipassword outside the redaction list`)
    assert.doesNotMatch(code, /\b(updateCloudInit|dumpCloudInit|setCloudInit|buildCloudInitConfig|validateCloudInitPreBoot|validateCloudInitDump|applyCloudInitConfig|ensureCloudInitBeforeStart|selfHealBeforeStart)\s*\(/, `${file} still calls a Cloud-Init helper`)
    assert.doesNotMatch(code, /missing\.push\("ci/, `${file} still checks for a Cloud-Init field`)
  }
  // The module that implemented the check is gone, not merely unreferenced.
  assert.throws(() => read("lib/cloud-init-config.ts"), /ENOENT/)
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
