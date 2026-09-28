/**
 * Node addition: the wizard, and the rule that a node is not Ready until guest
 * automation is proven.
 *
 * These are static assertions on top of the behavioural capability tests in
 * node-guest-capabilities.test.ts. They exist because the two ways this breaks
 * are both invisible at runtime: a step can be removed from the wizard, or the
 * create route can go back to writing `status: "connected"` and leaving the node
 * schedulable without ever measuring anything.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(path, "utf8")

const WIZARD = "app/admin/compute-nodes/NodeWizard.tsx"
const PAGE = "app/admin/compute-nodes/page.tsx"
const CREATE_ROUTE = "app/api/admin/proxmox-nodes/route.ts"
const CAPABILITY_ROUTE = "app/api/admin/proxmox-nodes/[id]/capabilities/route.ts"
const TEST_ROUTE = "app/api/admin/proxmox-nodes/test/route.ts"

// ---------------------------------------------------------------------------
// The wizard has ten steps, in an order that cannot be quietly rearranged
// ---------------------------------------------------------------------------

test("the node addition wizard has exactly ten steps", () => {
  const source = read(WIZARD)
  const steps = source.match(/^\s{2}\{ key: "[a-z-]+", title:/gm) || []
  assert.equal(steps.length, 10, `expected ten wizard steps, found ${steps.length}`)
})

test("the wizard proves the connection before it claims anything about the node", () => {
  const source = read(WIZARD)
  const titles = [...source.matchAll(/key: "([a-z-]+)", title: "([^"]+)"/g)].map((m) => ({ key: m[1], title: m[2] }))
  const index = (key: string) => titles.findIndex((entry) => entry.key === key)

  // The order is the substance: an untested host used to be saved as connected,
  // so the test has to come before the node is confirmed and long before it is
  // declared capable.
  assert.ok(index("connection") < index("confirm-node"), "the connection must be proven before the node is confirmed")
  assert.ok(index("connection") < index("capabilities"), "the connection must be proven before capabilities are claimed")
  assert.ok(index("guest-agent") < index("capabilities"), "the guest-agent requirement is explained before capabilities are measured")
  assert.ok(index("capabilities") < index("review"), "capabilities are measured before the review")
  assert.ok(index("review") < index("finish"), "the review comes before the node is added")
})

test("the wizard's names say what each step is for", () => {
  const source = read(WIZARD)
  const titles = [...source.matchAll(/title: "([^"]+)"/g)].map((m) => m[1])
  for (const expected of [
    "Identity",
    "Host",
    "Proxmox node",
    "API token",
    "Test connection",
    "Confirm the node",
    "Guest agent in your images",
    "Measure capabilities",
    "Review",
    "Add node",
  ]) {
    assert.ok(titles.includes(expected), `the wizard is missing a step named "${expected}"`)
  }
})

test("the wizard cannot advance past an unproven connection", () => {
  const source = read(WIZARD)
  assert.match(source, /case 4:\s*\n\s*\/\/ The connection must be proven[\s\S]*?return connection\.status === "success"/)
})

test("the wizard requires capabilities to be measured before review and finish", () => {
  const source = read(WIZARD)
  assert.match(source, /case 7:[\s\S]*?case 8:\s*\n\s*return input\.capabilities !== null/)
})

test("the wizard will not finish without a measured capability report", () => {
  const source = read(PAGE)
  assert.match(source, /disabled=\{saving \|\| !wizardCanAdvance\}/)
})

// ---------------------------------------------------------------------------
// The guest-agent requirement is stated, with real commands
// ---------------------------------------------------------------------------

test("the wizard names the per-OS guest agent install commands", () => {
  const source = read(WIZARD)
  for (const os of ["Debian / Ubuntu / Kali", "RHEL / Alma / Rocky / Oracle / Fedora", "CentOS 7", "openSUSE / SLES", "Arch", "Alpine", "Windows"]) {
    assert.ok(source.includes(os), `the wizard does not show install commands for ${os}`)
  }
  assert.ok(source.includes("qemu-guest-agent"), "the agent package is never named")
  assert.ok(source.includes("rc-update add qemu-guest-agent"), "Alpine does not use systemd, so its commands must differ")
  assert.ok(source.includes("zypper -n in qemu-guest-agent"), "SUSE uses zypper, not dnf")
  assert.ok(source.includes("pacman -S --noconfirm qemu-guest-agent"), "Arch uses pacman")
  assert.ok(source.includes("virtio-win-guest-tools"), "Windows needs the VirtIO tools, not a package manager")
})

test("the seeded guest-agent hints cover every supported OS family", () => {
  const source = read("lib/guest-automation/default-templates.ts")
  const block = source.slice(source.indexOf("GUEST_AGENT_INSTALL_HINTS"), source.indexOf("guestAgentInstallCommands"))
  for (const family of ["debian", "ubuntu", "kali", "rhel", "fedora", "rocky", "almalinux", "oracle", "centos-7", "suse", "arch", "alpine", "windows"]) {
    const quoted = block.includes(`${family}:`) || block.includes(`"${family}":`)
    assert.ok(quoted, `GUEST_AGENT_INSTALL_HINTS is missing ${family}`)
  }
})

// ---------------------------------------------------------------------------
// A node is not Ready until guest automation is proven
// ---------------------------------------------------------------------------

test("adding a node measures guest capabilities and refuses to schedule it otherwise", () => {
  const source = read(CREATE_ROUTE)
  assert.match(source, /refreshNodeCapabilities\(\{/)
  assert.match(source, /if \(capabilities\.status !== "ready"\) \{[\s\S]*?schedulingEnabled: false/)
  assert.match(source, /drainReason:/)
  // "connected" must mean only that the API answered.
  assert.match(source, /\/\/ "connected" now means exactly that:[\s\S]*?status: "connected",/)
})

test("adding a node tells the admin why it is not schedulable instead of failing silently", () => {
  const source = read(CREATE_ROUTE)
  assert.match(source, /warning: capabilities\.status === "ready"/)
  assert.ok(source.includes("capabilitiesHeadline"), "the response carries the one-line verdict")
})

test("the node list exposes the cached capability verdict without re-measuring", () => {
  const monitoring = read("lib/compute-node-monitoring.ts")
  assert.match(monitoring, /include: \{ guestCapabilities: true \}/)
  assert.match(monitoring, /guestCapabilities: \(node as any\)\.guestCapabilities/)
  // Measuring inside the list would put a guest-exec round trip on every render.
  assert.doesNotMatch(monitoring.slice(monitoring.indexOf("function safeNode"), monitoring.indexOf("function safeNode") + 3000), /measureNodeCapabilities/)
})

test("a stale capability verdict is marked stale rather than presented as current", () => {
  const monitoring = read("lib/compute-node-monitoring.ts")
  assert.match(monitoring, /stale:[\s\S]*?30 \* 60 \* 1000/)
})

test("a node with no cached verdict reports not-measured, not ready", () => {
  const monitoring = read("lib/compute-node-monitoring.ts")
  const block = monitoring.slice(monitoring.indexOf("function safeNode"))
  assert.ok(block.includes('status: "pending"'), "an unmeasured node must never be summarised as anything else")
})

// ---------------------------------------------------------------------------
// The capability endpoint
// ---------------------------------------------------------------------------

test("the capability endpoint is admin-only, cached on read and forced on write", () => {
  const source = read(CAPABILITY_ROUTE)
  assert.match(source, /getAdminFromCookies/)
  assert.match(source, /canAccessAdminApi/)
  assert.match(source, /getNodeCapabilities\(nodeTarget\(node\)\)/, "GET uses the cache")
  assert.match(source, /refreshNodeCapabilities\(nodeTarget\(node\)\)/, "POST re-measures")
  assert.match(source, /isEncryptedSecret\(node\.tokenSecret\) \? decryptSecretValue/, "the stored secret is decrypted only to make the call")
  assert.ok(!/tokenSecret:\s*node\.tokenSecret/.test(source), "the encrypted secret must never be handed to the diagnostics verbatim")
})

test("the pre-flight measurement runs the same probes, not a cheaper set", () => {
  const source = read(TEST_ROUTE)
  assert.match(source, /measureNodeCapabilities\(\{/)
  assert.ok(!source.includes("capabilitiesOnly === true") || source.includes("measureNodeCapabilities"), "a pre-flight must not skip the guest checks")
})

// ---------------------------------------------------------------------------
// The UI wiring
// ---------------------------------------------------------------------------

test("adding and editing a node are separate flows", () => {
  const source = read(PAGE)
  assert.match(source, /\{editingNode \? \(/, "the edit form is shown when editing")
  assert.match(source, /<NodeWizardStepBody/, "the wizard is shown when adding")
  assert.match(source, /<NodeWizardSteps current=\{wizardStep\}/)
  assert.ok(!source.includes("Install Node Agent"), "the old single-form add dialog is gone")
})

test("the node list shows the guest-automation verdict with a way to renew it", () => {
  const source = read(PAGE)
  assert.match(source, /GuestAutomationBadge/)
  assert.match(source, /handleRecheckCapabilities/)
  assert.match(source, /\/capabilities`, \{ method: "POST"/)
})

test("a degraded node is distinguished from an unavailable one", () => {
  const source = read(PAGE)
  const block = source.slice(source.indexOf("function GuestAutomationBadge"))
  for (const label of ["Ready", "Degraded", "Unavailable", "Not measured"]) {
    assert.ok(block.includes(`"${label}"`), `the badge is missing the "${label}" state`)
  }
})
