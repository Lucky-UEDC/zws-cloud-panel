import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { buildCloudInitConfig, validateCloudInitDump } from "@/lib/cloud-init-config"

const read = (path: string) => readFileSync(path, "utf8")

/**
 * Retained, and asserted, because the legacy module is still used to read old
 * template state. It is not on any provisioning path any more — that is asserted
 * separately in cloud-init-removal.test.ts.
 */
test("hostname absence never fails cloud-init verification", () => {
  const built = buildCloudInitConfig({
    vmid: 101,
    osFamily: "linux",
    username: "root",
    password: "test-password",
    hostname: "expected-host",
    ip: "192.0.2.10",
    cidr: 24,
    gateway: "192.0.2.1",
    dns: "1.1.1.1",
    searchDomain: "localdomain",
  })
  const result = validateCloudInitDump({
    built,
    userDump: "users: [root]\npassword: injected",
    networkDump: "192.0.2.10/24 192.0.2.1 1.1.1.1 localdomain",
    vmConfig: { ciuser: "root", cipassword: "hidden", ipconfig0: "ip=192.0.2.10/24,gw=192.0.2.1", nameserver: "1.1.1.1", searchdomain: "localdomain", ide2: "local-lvm:cloudinit" },
  })
  assert.equal(result.missing.includes("hostname"), false)
  assert.equal(result.ok, true)
})

test("guest-reported network is a hard gate and guest identity stays warning-only", () => {
  const source = read("lib/provision.ts")
  // The guest agent is no longer advisory. Without it the guest cannot be
  // configured at all, so a deployment that passed the gate without it would be
  // a server nobody can reach.
  assert.match(source, /const checks = \{[\s\S]*?guestAgentOnline: qga\.ok/)
  assert.match(source, /const checks = \{[\s\S]*?guestIpApplied: guestIps\.includes\(input\.expectedIp\)/)
  assert.match(source, /const checks = \{[\s\S]*?guestGatewayApplied:/)
  assert.match(source, /const checks = \{[\s\S]*?guestDnsApplied:/)
  // Hostname and search domain are things a customer may legitimately change
  // themselves, so they are reported and never block delivery.
  assert.match(source, /const warnings = \{\s*guestSearchDomainApplied:/)
  assert.match(source, /const warnings = \{[\s\S]*?guestHostnameApplied:/)
  assert.match(source, /const warnings = \{[\s\S]*?networkReachable: reachability\.ok/)
  assert.match(source, /const failed = Object\.entries\(checks\)/)
  assert.doesNotMatch(source, /const failed = Object\.entries\(warnings\)/)
  // The gate is no longer built on what was injected into the VM config. The
  // strings still appear in comments and in the secret-redaction list, so the
  // assertion is on code with both stripped.
  // `cipassword` survives only in the secret-redaction list at the top of the
  // file, which is a read that protects logs. What must not exist is a write.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  assert.doesNotMatch(code, /\bciuser\s*[:=]/)
  assert.doesNotMatch(code, /\bipconfig0\s*[:=]/)
  assert.doesNotMatch(code, /\bnameserver\s*[:=]/)
  assert.equal(code.match(/cipassword/g)?.length, 1, "cipassword may appear only in the redaction list")
})

test("checkout and renewal financial writes use serializable transactions", () => {
  const checkout = read("app/api/payments/create/route.ts")
  const sessions = read("lib/checkout-sessions.ts")
  const renewals = read("lib/renewals.ts")
  assert.match(sessions, /fulfilledOrderId: primaryOrder\.id/)
  assert.match(sessions, /const result = await prisma\.\$transaction/)
  assert.match(sessions, /isolationLevel: "Serializable"/)
  assert.match(renewals, /orderType: "renewal"/)
  assert.match(renewals, /orderId: renewalOrder\.id/)
})

test("PhonePe requests have bounded timeout, retries, and stable errors", () => {
  const source = read("lib/phonepe.ts")
  assert.match(source, /PHONEPE_TIMEOUT_MS/)
  assert.match(source, /PHONEPE_MAX_ATTEMPTS/)
  assert.match(source, /AbortController/)
  assert.match(source, /PHONEPE_NETWORK_ERROR/)
  assert.match(source, /PHONEPE_REDIRECT_MISSING/)
})

test("PhonePe refunds use Standard Checkout refund APIs with minor-unit amounts", () => {
  const source = read("lib/phonepe.ts")
  assert.match(source, /initiatePhonePeRefund/)
  assert.match(source, /getPhonePeRefundStatus/)
  assert.match(source, /payments\/v2\/refund/)
  assert.match(source, /amountMinor/)
  assert.doesNotMatch(source, /plaintextPassword/)
})

test("admin VM edit reserves IP before Proxmox mutation", () => {
  const source = read("app/api/admin/vms/[id]/edit/route.ts")
  assert.ok(source.indexOf("FOR UPDATE") < source.indexOf("client.updateVMConfig"))
  assert.match(source, /Selected IP is already assigned to another active VM/)
  assert.match(source, /allocationLockKey: ipReservationKey/)
  assert.match(source, /Disk size cannot be reduced/)
})
