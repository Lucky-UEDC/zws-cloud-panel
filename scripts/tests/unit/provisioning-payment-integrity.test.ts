import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { buildCloudInitConfig, validateCloudInitDump } from "@/lib/cloud-init-config"

const read = (path: string) => readFileSync(path, "utf8")

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

test("guest identity and reachability are warning-only provisioning evidence", () => {
  const source = read("lib/provision.ts")
  assert.match(source, /const warnings = \{\s*guestAgentOnline:/)
  assert.match(source, /const failed = Object\.entries\(checks\)/)
  assert.doesNotMatch(source, /const failed = Object\.entries\(warnings\)/)
  assert.match(source, /Hostname differs \(informational only\)/)
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
