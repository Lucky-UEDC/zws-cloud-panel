/**
 * Node capability model.
 *
 * The requirement this encodes: a compute node is not Ready because its API
 * answered. It is Ready only when the guest agent answers and `guest-exec`
 * runs to completion. Everything the tests below assert is a case where a
 * weaker implementation would have said "connected" and shipped VMs nobody
 * could configure.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  measureGuestCapabilities,
  summariseCapabilities,
  capabilityHeadline,
  capabilityLabel,
  summariseChecks,
  REQUIRED_CAPABILITIES,
  NODE_CAPABILITIES,
  CAPABILITY_CACHE_TTL_MS,
  GUEST_EXEC_TIMEOUT_MS,
  type CapabilityCheck,
  type GuestProbeClient,
  type NodeCapability,
} from "@/lib/guest-automation/node-capabilities"

// Read from the repository root as cwd, matching the other unit suites.
const read = (path: string) => readFileSync(path, "utf8")
const SOURCE = read("lib/guest-automation/node-capabilities.ts")
/** Comments are stripped so a note about a removed endpoint is not read as one. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

function check(key: NodeCapability, state: CapabilityCheck["state"], detail = ""): CapabilityCheck {
  return { key, label: capabilityLabel(key), state, detail, durationMs: 1, measured: true }
}

/** A client that answers everything, which is what a healthy node looks like. */
function healthyClient(overrides: Partial<GuestProbeClient> = {}): GuestProbeClient {
  return {
    getVMs: async () => [{ vmid: 114, status: "running", agent: 1 }],
    guestCmd: async (_node, _vmid, verb) => ({ result: verb === "get-osinfo" ? { name: "debian" } : {} }),
    execVMGuestCommand: async () => ({ pid: 4242 }),
    getVMGuestExecStatus: async () => ({ exited: 1, exitcode: 0, "out-data": "" }),
    ...overrides,
  }
}

async function measure(client: GuestProbeClient, nodeName = "pve1", execTimeoutMs?: number) {
  const checks: CapabilityCheck[] = []
  await measureGuestCapabilities({ client, checks, nodeName, execTimeoutMs })
  return checks
}

function stateOf(checks: CapabilityCheck[], key: NodeCapability) {
  return checks.find((entry) => entry.key === key)?.state
}

// ---------------------------------------------------------------------------
// The policy: what makes a node Ready
// ---------------------------------------------------------------------------

test("every documented capability is covered by the model", () => {
  for (const key of [
    "api_connectivity",
    "api_auth",
    "node_available",
    "vm_list",
    "guest_agent",
    "guest_exec",
    "guest_password",
    "guest_fsinfo",
    "guest_network",
    "console",
    "snapshot",
    "backup",
    "restore",
  ] as NodeCapability[]) {
    assert.ok(NODE_CAPABILITIES.includes(key), `${key} is missing from NODE_CAPABILITIES`)
  }
})

test("a fully passing node is ready", () => {
  const result = summariseCapabilities(NODE_CAPABILITIES.map((key) => check(key, "pass")))
  assert.equal(result.status, "ready")
  assert.deepEqual(result.blockers, [])
})

test("API connectivity alone never makes a node ready", () => {
  // This is the specific regression the model exists to prevent: a node that
  // answers /version but cannot run a guest command would have been "connected"
  // before, and would have been used to create servers nobody could configure.
  const checks = NODE_CAPABILITIES.map((key) => check(key, key === "api_connectivity" ? "pass" : "skip", "not probed"))
  const result = summariseCapabilities(checks)
  assert.equal(result.status, "failed")
  assert.ok(result.blockers.some((line) => line.startsWith("API token accepted")))
  assert.ok(result.blockers.some((line) => line.includes("Guest agent")))
  assert.ok(result.blockers.some((line) => line.includes("guest-exec")))
})

test("a skipped required capability is a blocker, never a pass", () => {
  const checks = NODE_CAPABILITIES.map((key) => check(key, REQUIRED_CAPABILITIES.has(key) && key === "guest_exec" ? "skip" : "pass"))
  const result = summariseCapabilities(checks)
  assert.equal(result.status, "failed")
  assert.ok(result.blockers.some((line) => line.includes("guest-exec runs and completes")))
})

test("a missing guest agent fails the node even when everything else passes", () => {
  const checks = NODE_CAPABILITIES.map((key) => check(key, key === "guest_agent" ? "fail" : "pass"))
  const result = summariseCapabilities(checks)
  assert.equal(result.status, "failed")
  assert.ok(result.blockers.some((line) => line.includes("Guest agent answers")))
})

test("a failing non-required capability degrades rather than fails the node", () => {
  // A node that cannot take a snapshot is still able to configure a guest.
  const checks = NODE_CAPABILITIES.map((key) => check(key, key === "snapshot" ? "fail" : "pass"))
  const result = summariseCapabilities(checks)
  assert.equal(result.status, "degraded")
  assert.ok(result.blockers.some((line) => line.includes("Snapshots")))
})

test("required capabilities are exactly the ones a guest operation needs", () => {
  assert.deepEqual([...REQUIRED_CAPABILITIES].sort(), [
    "api_auth",
    "api_connectivity",
    "guest_agent",
    "guest_exec",
    "node_available",
  ])
})

// ---------------------------------------------------------------------------
// The guest-side measurement, against known answers
// ---------------------------------------------------------------------------

test("a working guest passes every guest capability and the node is ready", async () => {
  const checks = await measure(healthyClient())
  assert.equal(stateOf(checks, "guest_agent"), "pass")
  assert.equal(stateOf(checks, "guest_exec"), "pass")
  assert.equal(stateOf(checks, "guest_password"), "pass")
  assert.equal(stateOf(checks, "guest_fsinfo"), "pass")
  assert.equal(stateOf(checks, "guest_network"), "pass")
  assert.ok(checks.find((entry) => entry.key === "guest_agent")!.detail.includes("debian"))
})

test("a guest whose image has no agent fails the node and says so", async () => {
  const client = healthyClient({
    guestCmd: async () => { throw new Error("Command 'guest-exec' failed: qemu-guest-agent is not installed") },
  })
  const checks = await measure(client)
  assert.equal(stateOf(checks, "guest_agent"), "fail")
  // Now tries all candidates and reports the list. The key assertion is that the
  // node is failed and the dependent checks are skipped.
  const detail = checks.find((entry) => entry.key === "guest_agent")!.detail
  assert.match(detail, /No running guest on this node answered the guest agent/)
  assert.match(detail, /no candidate answered/)
  // The dependent checks are skipped, never passed.
  for (const key of ["guest_exec", "guest_password", "guest_fsinfo", "guest_network"] as NodeCapability[]) {
    assert.equal(stateOf(checks, key), "skip", `${key} must be skipped, not passed, when the agent is absent`)
  }
  assert.equal(summariseCapabilities(checks).status, "failed")
})

test("a node with no running VM records skips and cannot be marked ready", async () => {
  const client = healthyClient({ getVMs: async () => [] })
  const checks = await measure(client)
  for (const key of ["guest_agent", "guest_exec", "guest_password", "guest_fsinfo", "guest_network"] as NodeCapability[]) {
    assert.equal(stateOf(checks, key), "skip")
  }
  assert.match(checks.find((entry) => entry.key === "guest_agent")!.detail, /re-run diagnostics/)
  assert.equal(summariseCapabilities(checks).status, "failed")
})

test("a stopped VM is not a guest test candidate", async () => {
  const client = healthyClient({ getVMs: async () => [{ vmid: 114, status: "stopped", agent: 1 }] })
  const checks = await measure(client)
  assert.equal(stateOf(checks, "guest_agent"), "skip")
})

test("guest-exec must report an exit code, not merely accept a start request", async () => {
  // A node that returns a pid and then never exits would leave every operation
  // hanging until its timeout. Accepting the start request is not proof.
  let polls = 0
  const client = healthyClient({
    getVMGuestExecStatus: async () => {
      polls += 1
      return { exited: 1, exitcode: 0 }
    },
  })
  const checks = await measure(client)
  assert.equal(stateOf(checks, "guest_exec"), "pass")
  assert.ok(polls >= 1, "the exit status must actually be polled")
  assert.match(checks.find((entry) => entry.key === "guest_exec")!.detail, /exited 0/)
})

test("guest-exec that never returns a pid fails rather than passing", async () => {
  const client = healthyClient({ execVMGuestCommand: async () => ({}) as any })
  const checks = await measure(client)
  assert.equal(stateOf(checks, "guest_exec"), "fail")
  assert.match(checks.find((entry) => entry.key === "guest_exec")!.detail, /did not return a pid/)
})

test("guest-exec that accepts a start request but never reports an exit fails", async () => {
  // `exited: 0` is what a still-running command looks like. A node that accepts
  // the start and never finishes would leave every operation hanging until its
  // timeout, so it must be reported as a failure.
  const client = healthyClient({ getVMGuestExecStatus: async () => ({ exited: 0, exitcode: 0 }) })
  const checks = await measure(client, "pve1", 300)
  assert.equal(stateOf(checks, "guest_exec"), "fail")
  assert.match(checks.find((entry) => entry.key === "guest_exec")!.detail, /never reported an exit within 300ms/)
})

test("the node-status probe matches the endpoint the diagnostic actually emits", () => {
  // Found by running the model against a live node that was reported as
  // "failed" while being entirely healthy.
  //
  // The diagnostic step's endpoint is the full API path
  // (`/api2/json/nodes/<name>/status`), and the name half is only emitted on
  // failure — so matching on the bare relative form found nothing on a healthy
  // node. The required capability was recorded as never probed, and a
  // never-probed required capability is a blocker.
  assert.ok(CODE.includes('/nodes/'), 'the node-status probe matches on the endpoint path')
  assert.ok(!CODE.includes('step.endpoint === `/nodes/${encodeURIComponent(input.nodeName)}/status`'))
  // And a node that answered everything else is evidence enough on its own.
  assert.match(CODE, /else if \(connection\.ok\) \{/)
  assert.match(CODE, /answered the node and VM endpoints/)
})

test("the console probe uses an endpoint that exists and an endpoint that does not fake a failure", () => {
  // `vncwebsocket` is not a Proxmox endpoint; it answers "not implemented" on
  // every node, which reported working consoles as broken. `vncproxy` is what
  // noVNC uses.
  assert.ok(!CODE.includes("vncwebsocket"), "the console probe uses an endpoint Proxmox does not have")
  assert.match(CODE, /\/vncproxy`/)
  // A 404 or "not implemented" is a missing endpoint, not a broken console.
  assert.match(CODE, /not implemented/)
  assert.match(CODE, /this Proxmox does not expose it/)
})

test("the console probe targets a VM this node actually has", () => {
  // The shared feature diagnostic probes a hard-coded VMID that may not exist.
  // Probing nothing tells us nothing about the node and produced a false
  // negative on a healthy node.
  assert.match(CODE, /No running VM on this node to probe a console against/)
})

test("the guest-exec exit timeout is bounded rather than indefinite", () => {
  assert.ok(GUEST_EXEC_TIMEOUT_MS > 0)
  assert.ok(GUEST_EXEC_TIMEOUT_MS <= 30_000, "an unbounded wait would hide a broken channel behind a slow node")
})

test("guest-exec that exits non-zero fails", async () => {
  const client = healthyClient({ getVMGuestExecStatus: async () => ({ exited: 1, exitcode: 126 }) })
  const checks = await measure(client)
  assert.equal(stateOf(checks, "guest_exec"), "fail")
  assert.match(checks.find((entry) => entry.key === "guest_exec")!.detail, /exited 126/)
})

test("a VM whose Proxmox agent flag is set but which does not answer is still a failure", async () => {
  // The hypervisor flag says the channel is open. It does not say an agent is
  // installed in the image. Trusting the flag is exactly the bug this closes.
  const client = healthyClient({
    getVMs: async () => [{ vmid: 114, status: "running", agent: 1 }],
    guestCmd: async () => { throw new Error("QEMU guest agent is not running") },
  })
  const checks = await measure(client)
  assert.equal(stateOf(checks, "guest_agent"), "fail")
})

test("each native verb is called for real rather than assumed", async () => {
  const seen: string[] = []
  const client = healthyClient({
    guestCmd: async (_node, _vmid, verb) => {
      seen.push(verb)
      return { result: {} }
    },
  })
  await measure(client)
  assert.ok(seen.includes("get-osinfo"))
  assert.ok(seen.includes("get-users"), "the native password path must be probed")
  assert.ok(seen.includes("get-fsinfo"))
  assert.ok(seen.includes("network-get-interfaces"))
})

test("a native verb that fails fails only its own capability", async () => {
  const client = healthyClient({
    guestCmd: async (_node, _vmid, verb) => {
      if (verb === "get-fsinfo") throw new Error("command not supported")
      return { result: verb === "get-osinfo" ? { name: "ubuntu" } : {} }
    },
  })
  const checks = await measure(client)
  assert.equal(stateOf(checks, "guest_fsinfo"), "fail")
  assert.equal(stateOf(checks, "guest_agent"), "pass")
  assert.equal(stateOf(checks, "guest_network"), "pass")
  // Not a required capability, so the node is degraded, not failed.
  assert.equal(summariseCapabilities(checks).status, "degraded")
})

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

test("the headline never claims readiness that was not measured", () => {
  const failed = summariseCapabilities(NODE_CAPABILITIES.map((key) => check(key, "pass", "fine")))
  assert.match(capabilityHeadline({
    nodeId: "n", nodeName: "pve1", status: failed.status, checks: [], summary: summariseChecks([]),
    blockers: failed.blockers, lastCheckedAt: null, lastSuccessAt: null, fromCache: false,
  }), /Ready/)

  const notReady = summariseCapabilities(NODE_CAPABILITIES.map((key) => check(key, key === "guest_agent" ? "fail" : "pass", "no agent")))
  assert.match(capabilityHeadline({
    nodeId: "n", nodeName: "pve1", status: notReady.status, checks: [], summary: summariseChecks([]),
    blockers: notReady.blockers, lastCheckedAt: null, lastSuccessAt: null, fromCache: false,
  }), /Guest agent answers: no agent/)
})

test("counts add up to the number of checks", () => {
  const checks = [
    check("api_connectivity", "pass"),
    check("guest_agent", "fail"),
    check("guest_exec", "skip"),
    check("snapshot", "warn"),
  ]
  const summary = summariseChecks(checks)
  assert.equal(summary.pass, 1)
  assert.equal(summary.fail, 1)
  assert.equal(summary.skip, 1)
  assert.equal(summary.warn, 1)
  assert.equal(summary.total, checks.length)
})

test("the cache window is long enough to protect the API and short enough to stay honest", () => {
  assert.ok(CAPABILITY_CACHE_TTL_MS > 0)
  assert.ok(CAPABILITY_CACHE_TTL_MS <= 30 * 60 * 1000, "a cached capability report older than 30 minutes is a claim nobody verified")
})
