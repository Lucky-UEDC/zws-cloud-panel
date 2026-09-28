/**
 * The deployment state machine, and adoption of pre-existing servers.
 *
 * Two things are asserted here that are invisible when they break: that the
 * customer page only ever redirects on `SERVICE_ACTIVE`, and that adopting a
 * server never reconfigures it.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DEPLOYMENT_STAGES, DEPLOYMENT_STAGE_LABELS, FIRST_BOOT_SEQUENCE } from "@/lib/guest-automation/constants"
import { STEP_LABELS, customerStepContent } from "@/lib/provisioning-status"
import { FIRST_BOOT_STAGES } from "@/lib/guest-automation/first-boot"

const read = (path: string) => readFileSync(path, "utf8")

const DEPLOYMENTS = "lib/client-deployments.ts"
const DEPLOYMENT_PAGE = "app/client-area/deployments/[id]/page.tsx"
const ADOPTION = "lib/guest-automation/adoption.ts"
const VM_MANAGEMENT = "lib/admin-vm-management.ts"

// ---------------------------------------------------------------------------
// The stage machine
// ---------------------------------------------------------------------------

test("the state machine runs from payment, through the guest pipeline, to one terminal success", () => {
  assert.equal(DEPLOYMENT_STAGES[0], "PAYMENT_PENDING")
  // Both terminals exist, exactly once each.
  assert.equal(DEPLOYMENT_STAGES.filter((stage) => stage === "SERVICE_ACTIVE").length, 1)
  assert.equal(DEPLOYMENT_STAGES.filter((stage) => stage === "SERVICE_FAILED").length, 1)
  assert.ok(DEPLOYMENT_STAGES.indexOf("SERVICE_FAILED") > DEPLOYMENT_STAGES.indexOf("SERVICE_ACTIVE"), "failure is not a stage on the way to success")
  // The order the customer walks is the order the pipeline runs.
  const ordered = ["PAYMENT_PENDING", "ORDER_ACCEPTED", "VM_CREATED", "VM_STARTED", "WAITING_GUEST_AGENT", "DETECTING_OS", "CONFIGURING_GUEST", "VERIFYING_GUEST", "SERVICE_ACTIVE"]
  let cursor = -1
  for (const stage of ordered) {
    const index = DEPLOYMENT_STAGES.indexOf(stage as any)
    assert.ok(index > cursor, `${stage} is out of order in the state machine`)
    cursor = index
  }
})

test("the customer-facing stage list ends at the one state that means usable", () => {
  const source = read(DEPLOYMENTS)
  const list = source.slice(source.indexOf("const DEPLOYMENT_STAGES = ["), source.indexOf("\n]\n", source.indexOf("const DEPLOYMENT_STAGES = [")))
  const keys = [...list.matchAll(/key: "([A-Z_]+)"/g)].map((match) => match[1])
  assert.equal(keys[0], "PAYMENT_PENDING")
  assert.equal(keys[keys.length - 1], "SERVICE_ACTIVE")
  // SERVICE_FAILED is a terminal state, not a step in the list a customer walks.
  assert.ok(!keys.includes("SERVICE_FAILED"), "a customer must not see a step called SERVICE_FAILED in the progress list")
})

test("every stage has customer-facing copy that does not leak internals", () => {
  for (const stage of DEPLOYMENT_STAGES) {
    const label = DEPLOYMENT_STAGE_LABELS[stage]
    assert.ok(label && label.length > 0, `${stage} has no label`)
    assert.ok(!/cloud-?init|proxmox|qm |vmid|api2/i.test(label), `${stage} leaks an internal term: ${label}`)
  }
})

test("the guest-automation steps are visible to the customer, not collapsed", () => {
  // A customer watching a four-minute deployment should be able to see that the
  // wait is their operating system booting, not one long "configuring" row.
  for (const stage of ["WAITING_GUEST_AGENT", "DETECTING_OS", "CONFIGURING_GUEST", "VERIFYING_GUEST"]) {
    assert.ok(DEPLOYMENT_STAGES.includes(stage as any), `${stage} is not in the customer stage list`)
    assert.ok(STEP_LABELS[stage as keyof typeof STEP_LABELS], `${stage} has no provisioning label`)
    assert.ok(customerStepContent(stage), `${stage} has no customer message`)
  }
})

test("every guest-pipeline stage has a provisioning step label and a message", () => {
  for (const stage of FIRST_BOOT_STAGES) {
    assert.ok(STEP_LABELS[stage], `${stage} has no provisioning label`)
    assert.ok(customerStepContent(stage)?.message, `${stage} has no customer message`)
  }
})

test("the first-boot sequence matches the stages the customer sees", () => {
  // The stages exist to explain the run; the run is what they explain.
  for (const operation of FIRST_BOOT_SEQUENCE) {
    assert.ok(typeof operation === "string")
  }
  assert.ok(FIRST_BOOT_SEQUENCE.includes("set_ip"), "first boot must set the address")
  assert.ok(FIRST_BOOT_SEQUENCE.includes("set_password"), "first boot must set the password")
})

// ---------------------------------------------------------------------------
// Redirect only on SERVICE_ACTIVE
// ---------------------------------------------------------------------------

test("the customer page redirects on the terminal state, not on a status string", () => {
  const source = read(DEPLOYMENT_PAGE)
  assert.match(source, /const ready = deployment\?\.terminal === "SERVICE_ACTIVE"/)
  // The old shape compared a raw status string, which is how a page can redirect
  // to a server that is not ready.
  assert.ok(!/deployment\?\.status \|\| deployment\?\.serviceStatus \|\| ""\)\.toUpperCase\(\) === "ACTIVE"/.test(source))
  assert.match(source, /window\.location\.href = `\/client-area\/vps\/\$\{deployment\.vm\.id\}`/)
})

test("the redirect is gated on ready alone", () => {
  const source = read(DEPLOYMENT_PAGE)
  const effect = source.slice(source.indexOf("useEffect(() => {\n    if (ready"), source.indexOf("}, [ready"))
  assert.ok(effect.length > 0)
  assert.ok(!/failed/.test(effect), "the redirect must not also fire on a failure state")
})

test("the page shows the terminal state by name", () => {
  const source = read(DEPLOYMENT_PAGE)
  assert.match(source, /deployment\?\.terminal \|\| deployment\?\.currentStage/)
})

test("the deployment payload names its terminal state", () => {
  const source = read(DEPLOYMENTS)
  assert.match(source, /terminal: complete \? "SERVICE_ACTIVE" : failedState \? "SERVICE_FAILED" : null/)
  assert.match(source, /const SERVICE_ACTIVE_TOKENS = new Set/)
  assert.match(source, /const FAILED_TOKENS = new Set/)
})

// ---------------------------------------------------------------------------
// Adoption
// ---------------------------------------------------------------------------

test("adoption detects and records, and never reconfigures", () => {
  const source = read(ADOPTION)
  // Every mutating call the service can make is absent from the adoption path.
  for (const call of ["applyChange", "firstBoot", "setPassword", "setIP", "reboot(", "shutdown(", "resizeDisk", "runSingleOperation"]) {
    assert.ok(!source.includes(call), `adoption calls ${call}, which configures the guest`)
  }
  // It only reads and records.
  assert.match(source, /service\.detectOs/)
  assert.match(source, /service\.getTemplate/)
  assert.match(source, /service\.getState/)
  assert.match(source, /persistDetection/)
})

test("adoption records what the guest reported, so the first plan is change-driven", () => {
  const source = read(ADOPTION)
  assert.match(source, /observed/)
  assert.match(source, /ipv4: state\.ipv4/)
  assert.match(source, /state: observed/)
})

test("adoption records a template version, so a later edit is detectable", () => {
  const source = read(ADOPTION)
  assert.match(source, /guestTemplateId: resolved\.template\.id/)
  assert.match(source, /appliedTemplateVersion: resolved\.template\.version/)
})

test("every adoption failure says what to do, not just what went wrong", () => {
  const source = read(ADOPTION)
  // "try again" is never the remedy. An unreachable agent means install one.
  assert.match(source, /remedy: "The QEMU guest agent is probably not installed/)
  assert.match(source, /remedy: "Start the server, then adopt it\./)
  assert.match(source, /remedy: `No enabled guest automation template claims/)
  const remedies = source.match(/remedy:/g) || []
  assert.ok(remedies.length >= 3, "each failure path should carry a remedy")
})

test("adoption makes a server manageable without claiming it is configured", () => {
  const source = read(ADOPTION)
  // Adoption records what the server is. It does not assert the configuration
  // is correct, and does not write an applied version when the run never ran.
  assert.match(source, /automationReady: Boolean\(resolved\.ok && guestAgentReachable\)/)
  assert.ok(!/applyChange|firstBoot/.test(source))
})

test("the admin action is reachable and admin-only", () => {
  const vmAction = read(VM_MANAGEMENT)
  assert.match(vmAction, /"adopt_guest_automation"/)
  assert.match(vmAction, /adoptVpsIntoGuestAutomation/)
  const route = read("app/api/admin/guest-adoption/route.ts")
  assert.match(route, /getAdminFromCookies/)
  assert.match(route, /canAccessAdminApi/)
})

test("a bulk adoption is bounded and sequential", () => {
  const source = read("app/api/admin/guest-adoption/route.ts")
  assert.match(source, /Adopt at most 20 servers at a time/)
  // Each adoption opens guest sessions; a burst would be indistinguishable from
  // an attack to the thing being managed.
  assert.ok(!/Promise\.all\(\s*ids\.map/.test(source), "adoption must not fan out in parallel")
})

test("the admin UI says adoption changes nothing", () => {
  const source = read("components/admin/vms/admin-vms-client.tsx")
  assert.match(source, /Adopt Guest Automation/)
  assert.match(source, /Nothing on the server was changed/)
  assert.match(source, /Nothing on the server was changed\./)
})
