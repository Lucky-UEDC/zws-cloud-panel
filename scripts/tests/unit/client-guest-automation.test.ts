/**
 * Customer guest automation endpoints.
 *
 * The single most important property here is negative: a customer must not be
 * able to make the panel run a command. These tests assert that the accepted
 * request shape is intent only, that the forbidden fields are actually rejected
 * rather than merely ignored, and that nothing which could carry a secret is
 * logged or returned.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  assertIntentOnly,
  parseIpv4,
  parsePrefix,
  parseDnsList,
  parseUsername,
  parsePassword,
  guestFailureToResponse,
  publicRunResult,
  CustomerRequestError,
  NO_STORE,
} from "@/app/api/client/vps/[id]/guest/_shared"

const read = (path: string) => readFileSync(path, "utf8")
const BASE = "app/api/client/vps/[id]/guest"

// ---------------------------------------------------------------------------
// Intent only
// ---------------------------------------------------------------------------

test("a request that carries a command is refused, not silently ignored", () => {
  for (const field of ["command", "shell", "arguments", "args", "script", "cmd", "powershell", "bash", "templateId", "engine", "operation"]) {
    assert.throws(
      () => assertIntentOnly({ ip: "192.0.2.10", [field]: "whatever" }),
      (error: unknown) => error instanceof CustomerRequestError && error.code === "COMMAND_FIELDS_NOT_ACCEPTED",
      `${field} was accepted`,
    )
  }
})

test("a plain intent request passes", () => {
  assert.doesNotThrow(() => assertIntentOnly({ ip: "192.0.2.10", prefix: 24, gateway: "192.0.2.1", dns: ["1.1.1.1"] }))
  assert.doesNotThrow(() => assertIntentOnly({ password: "correct-horse" }))
  assert.doesNotThrow(() => assertIntentOnly({ action: "create", username: "deploy", password: "correct-horse" }))
  assert.doesNotThrow(() => assertIntentOnly({}))
})

test("a non-object body is refused", () => {
  for (const body of [null, undefined, "string", 42, ["a"]]) {
    assert.throws(() => assertIntentOnly(body), CustomerRequestError, `${JSON.stringify(body)} was accepted`)
  }
})

test("no customer route reads a command, shell or operation off the body", () => {
  for (const route of ["network", "password", "users", "reboot", "shutdown", "status"]) {
    const source = read(`${BASE}/${route}/route.ts`)
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    // A mention in a comment or a string is fine; reading one into a command is
    // not. The check is that no route passes one into the service.
    assert.ok(!/service\.[a-zA-Z]+\([^)]*\b(command|shell)\b/.test(code), `${route} passes a command or shell into the service`)
    assert.ok(!/body\.(command|shell|arguments|script)\b/.test(code), `${route} reads body.${"command|shell|arguments|script"}`)
  }
})

test("every customer route asserts intent only before doing anything", () => {
  for (const route of ["network", "password", "users", "reboot", "shutdown"]) {
    const source = read(`${BASE}/${route}/route.ts`)
    assert.match(source, /assertIntentOnly\(body\)/, `${route} does not call assertIntentOnly`)
    // And it must come before the service is even constructed.
    assert.ok(
      source.indexOf("assertIntentOnly(body)") < source.indexOf("requireOwnedVps("),
      `${route} authenticates before rejecting a command-shaped request`,
    )
  }
})

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("addresses and prefixes are validated", () => {
  assert.equal(parseIpv4("192.0.2.10", "IP"), "192.0.2.10")
  for (const bad of ["192.0.2.256", "192.0.2", "192.0.2.10/24", "not-an-ip", "0.0.0.0", "", "  ", "192.0.2.1; rm -rf /"]) {
    assert.throws(() => parseIpv4(bad, "IP"), CustomerRequestError, `${bad} was accepted as an address`)
  }
  assert.equal(parsePrefix(24), 24)
  assert.equal(parsePrefix("0"), 0)
  for (const bad of [-1, 33, 24.5, "twenty-four", "", null, undefined]) {
    assert.throws(() => parsePrefix(bad), CustomerRequestError, `${bad} was accepted as a prefix`)
  }
})

test("nameservers are validated as a list of addresses", () => {
  assert.deepEqual(parseDnsList(["1.1.1.1", "8.8.8.8"]), ["1.1.1.1", "8.8.8.8"])
  assert.deepEqual(parseDnsList("1.1.1.1, 8.8.8.8"), ["1.1.1.1", "8.8.8.8"])
  assert.throws(() => parseDnsList([]), CustomerRequestError)
  assert.throws(() => parseDnsList(["1.1.1.1", "nope"]), CustomerRequestError)
  assert.throws(() => parseDnsList(["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4", "5.5.5.5"]), CustomerRequestError)
})

test("usernames are narrow enough to be safe inside a quoted command", () => {
  assert.equal(parseUsername("deploy"), "deploy")
  assert.equal(parseUsername("zws_admin"), "zws_admin")
  assert.equal(parseUsername("deploy2"), "deploy2")
  for (const bad of [
    "", "2deploy", "deploy; rm -rf /", "deploy'$(id)", "deploy`id`", "deploy user", "deploy\nroot",
    "a".repeat(64), "deploy\\", '"deploy"',
  ]) {
    assert.throws(() => parseUsername(bad), CustomerRequestError, `${JSON.stringify(bad)} was accepted as a username`)
  }
})

test("passwords have a floor and cannot smuggle a line break", () => {
  assert.equal(parsePassword("correct-horse"), "correct-horse")
  for (const bad of ["short", "", "with\nnewline", "with\rreturn", "with\x00null"]) {
    assert.throws(() => parsePassword(bad), CustomerRequestError, `${JSON.stringify(bad)} was accepted as a password`)
  }
  assert.throws(() => parsePassword("a".repeat(300)), CustomerRequestError)
})

// ---------------------------------------------------------------------------
// Refusals a customer can act on
// ---------------------------------------------------------------------------

test("each refusal maps to a status that tells the customer what to do", () => {
  const cases: Array<[string, number]> = [
    ["OS_DETECTION_UNAVAILABLE", 412],
    ["OS_TEMPLATE_MISSING", 422],
    ["OS_TEMPLATE_DISABLED", 422],
    ["VM_STOPPED_REQUIRED", 409],
    ["GUEST_AGENT_UNREACHABLE", 503],
    ["SOMETHING_ELSE", 409],
  ]
  for (const [code, status] of cases) {
    const result = guestFailureToResponse(code)
    assert.equal(result.status, status, `${code} mapped to ${result.status}, expected ${status}`)
    assert.ok(result.body.error && result.body.error.length > 10, `${code} produced no usable message`)
  }
})

test("stopping a server requires an explicit confirmation", () => {
  const source = read(`${BASE}/shutdown/route.ts`)
  assert.match(source, /body\.confirm !== true/)
  assert.match(source, /CONFIRMATION_REQUIRED/)
  assert.match(source, /It will not be reachable until you start it again/)
})

test("a customer cannot reset an account other than their own login", () => {
  const source = read(`${BASE}/password/route.ts`)
  assert.match(source, /403/)
  assert.match(source, /only reset the password for the account on this server/)
  const users = read(`${BASE}/users/route.ts`)
  assert.match(users, /PRIMARY_ACCOUNT/)
  assert.match(users, /cannot be changed here/)
})

// ---------------------------------------------------------------------------
// Nothing secret leaves or is written
// ---------------------------------------------------------------------------

test("a run result carries operation outcomes and never a command", () => {
  const result = publicRunResult({
    runId: "run_1",
    status: "success",
    steps: [{
      operation: "set_ip",
      status: "success",
      changed: true,
      verified: true,
      durationMs: 1200,
      errorCode: null,
      error: null,
      // Extra fields a future change might add, which must not leak through.
      commandMasked: "ip addr add 192.0.2.10/24 dev eth0",
    } as any],
    detected: { osId: "debian", name: "Debian 12", version: "12", engine: "linux" },
  })
  const serialised = JSON.stringify(result)
  assert.ok(!serialised.includes("ip addr add"), "a command leaked into the customer response")
  assert.ok(!serialised.includes("commandMasked"))
  assert.equal(result.operations[0].operation, "set_ip")
  assert.equal(result.operations[0].verified, true)
})

test("the password route records the username and nothing about the value", () => {
  const source = read(`${BASE}/password/route.ts`)
  // The success-path audit entry is the one that would leak if a password were
  // ever added to it.
  const successEntry = source.match(/action: "password", actor, result: \{([^}]*)\}/)
  assert.ok(successEntry, "the success-path audit entry was not found")
  assert.match(successEntry[1], /username/)
  assert.ok(!/password/i.test(successEntry[1]), "the audit entry carries something about the password value")
  assert.ok(!/password\.length/.test(source), "a password length is as revealing as the password")
})

test("the password is never placed in a command", () => {
  const source = read(`${BASE}/password/route.ts`)
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  // It is read, validated, handed to the service, and dropped.
  assert.match(code, /service\.setPassword\(\{ username, password/)
  assert.ok(!/JSON\.stringify\(\{[^}]*password/.test(code), "the password is being serialised somewhere")
})

test("every customer guest route is unauthenticated-safe and uncached", () => {
  for (const route of ["status", "network", "password", "users", "reboot", "shutdown"]) {
    const source = read(`${BASE}/${route}/route.ts`)
    assert.match(source, /requireOwnedVps\(id, request\)|getClientFromCookies/, `${route} has no ownership check`)
    assert.ok(source.includes("NO_STORE"), `${route} does not disable caching`)
  }
  assert.match(NO_STORE["Cache-Control"], /no-store/)
})

test("the status route reports an unreachable agent as a state, not an error", () => {
  const source = read(`${BASE}/status/route.ts`)
  // A guest that has not finished booting is not broken, and returning a 5xx
  // would make the customer page look broken rather than "still starting".
  assert.match(source, /guestAgentReachable: false/)
  assert.match(source, /success: true/)
  assert.match(source, /if it has just started, wait a minute and refresh/i)
})

test("the status route does not leak a Proxmox node, vmid or template id", () => {
  const source = read(`${BASE}/status/route.ts`)
  const serialised = source.slice(source.indexOf("return NextResponse.json({", source.indexOf("detected.kind")))
  for (const leak of ["nodeName", "vmid", "proxmoxNode", "host:", "templateId"]) {
    assert.ok(!serialised.includes(leak), `the customer status response includes ${leak}`)
  }
})
