/**
 * Admin guest-automation template management.
 *
 * The invariants here are the ones a broken editor would violate silently: a
 * template that cannot work must not save, must not enable, and must not be
 * reachable for a test that would run a dangerous operation because someone
 * clicked a button.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { draftFromPayload, structuralIssues } from "@/lib/guest-automation/admin-templates"
import { validateTemplateDraft } from "@/lib/guest-automation/validation"
import { guestAgentInstallCommands } from "@/lib/guest-automation/default-templates"

const read = (path: string) => readFileSync(path, "utf8")

const CREATE_ROUTE = "app/api/admin/guest-os-templates/route.ts"
const PATCH_ROUTE = "app/api/admin/guest-os-templates/[id]/route.ts"
const TEST_ROUTE = "app/api/admin/guest-os-templates/[id]/test/route.ts"
const OP_TEST_ROUTE = "app/api/admin/guest-os-templates/[id]/operations/[operation]/test/route.ts"
const PAGE = "app/admin/os-guest-automation/page.tsx"

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    name: "Debian 12",
    slug: "debian-12",
    family: "debian",
    engine: "linux",
    osIds: ["debian"],
    priority: 100,
    enabled: false,
    operations: [
      {
        operation: "set_hostname",
        enabled: true,
        commandType: "guest-exec",
        shell: "linux-sh",
        command: "hostnamectl set-hostname '{{HOSTNAME}}'",
        verificationCommand: "get-host-name",
        verificationParser: "native-hostname",
        verificationRequired: true,
        dangerLevel: "safe",
        requiresRunning: true,
        timeoutSeconds: 30,
      },
    ],
    ...overrides,
  }
}

function issuesFor(overrides: Record<string, unknown> = {}) {
  return structuralIssues(draftFromPayload(basePayload(overrides)))
}

// ---------------------------------------------------------------------------
// A template that could not work is refused
// ---------------------------------------------------------------------------

test("a well-formed Linux template has no structural issues", () => {
  assert.deepEqual(issuesFor(), [])
})

test("a template that claims no OS id is refused", () => {
  // The guest agent reports an OS id. A template matching on nothing can never
  // be selected, so it would sit in the catalogue looking usable forever.
  const issues = issuesFor({ osIds: [] })
  assert.ok(issues.some((line) => /No OS ids are claimed/.test(line)))
})

test("an unknown engine is refused", () => {
  const issues = issuesFor({ engine: "freebsd" })
  assert.ok(issues.some((line) => /Engine must be one of/.test(line)))
})

test("a secret inlined into a command is refused", () => {
  // Passwords reach the guest on stdin. A command that interpolates {{PASSWORD}}
  // would put the value in argv, where it is visible in the process list.
  const issues = issuesFor({
    operations: [{ ...basePayload().operations[0], command: "echo 'chpasswd' <<< '{{USERNAME}}:{{PASSWORD}}'" }],
  })
  assert.ok(issues.some((line) => /Secrets are passed to the guest on stdin/.test(line)), issues.join(" | "))
})

test("a shell command with no command text is refused", () => {
  const issues = issuesFor({ operations: [{ operation: "set_dns", commandType: "guest-exec", shell: "linux-sh", command: null }] })
  assert.ok(issues.some((line) => /no command text/.test(line)))
})

test("a duplicated operation is refused", () => {
  const operations = [basePayload().operations[0], { ...basePayload().operations[0] }]
  const issues = issuesFor({ operations })
  assert.ok(issues.some((line) => /defined more than once/.test(line)))
})

test("a non-shell operation is not judged on its command text", () => {
  // A guest-native operation is run by the agent, not by a shell, so it has no
  // command line to inspect. Rejecting it for having no command would make the
  // native verbs unusable.
  const issues = issuesFor({
    engine: "windows",
    operations: [{ operation: "set_password", commandType: "guest-native", shell: null, command: "set-user-password", enabled: true }],
  })
  assert.deepEqual(issues, [])
})

// ---------------------------------------------------------------------------
// The engine gate is the same one production uses
// ---------------------------------------------------------------------------

test("a Windows command in a Linux template is rejected by the same validator production uses", () => {
  const draft = draftFromPayload(basePayload({
    operations: [{ operation: "set_dns", commandType: "guest-exec", shell: "windows-powershell", command: "Set-DnsClientServerAddress -InterfaceAlias '{{NIC}}' -ServerAddresses {{DNS1}}" }],
  }))
  const result = validateTemplateDraft(draft)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((entry) => /engine|shell|linux|windows/i.test(entry.message)), JSON.stringify(result.errors))
})

test("a Linux command in a Windows template is rejected", () => {
  const draft = draftFromPayload(basePayload({
    engine: "windows",
    osIds: ["windows"],
    operations: [{ operation: "set_dns", commandType: "guest-exec", shell: "linux-sh", command: "resolvectl dns {{NIC}} {{DNS1}}" }],
  }))
  const result = validateTemplateDraft(draft)
  assert.equal(result.ok, false)
})

// ---------------------------------------------------------------------------
// Enabling is stricter than saving
// ---------------------------------------------------------------------------

test("saving a draft never enables it", () => {
  const source = read("lib/guest-automation/admin-templates.ts")
  const create = source.slice(source.indexOf("export async function createGuestTemplate"))
  // `enabled` comes from the payload, and the PATCH route forces it false for a
  // plain edit. Both must be visible, because "I saved and it turned itself on"
  // would change what a re-provisioned server gets.
  assert.match(create, /enabled: draft\.enabled === true/)
  assert.match(read(PATCH_ROUTE), /draftFromPayload\(\{ \.\.\.body, enabled: false \}\)/)
})

test("a template with no enabled operation cannot be enabled", () => {
  const source = read("lib/guest-automation/admin-templates.ts")
  assert.match(source, /has no enabled operation, so enabling it would do nothing/)
})

test("a newly added operation starts disabled with no command", () => {
  const source = read(PATCH_ROUTE)
  const block = source.slice(source.indexOf("function defaultOperationDraft"))
  assert.match(block, /enabled: false/)
  assert.match(block, /command: null/)
  // A plausible-looking default command would be a command nobody wrote, running
  // on a customer's server.
  assert.ok(!/command: "(?!null)/.test(block), "the default operation must not ship with a command")
})

test("a template that has configured servers cannot be deleted", () => {
  const source = read("lib/guest-automation/admin-templates.ts")
  assert.match(source, /vmGuestAdoption\.count/)
  assert.match(source, /Disable it instead/)
})

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

test("a behavioural edit bumps the version and a cosmetic one does not", () => {
  const source = read("lib/guest-automation/admin-templates.ts")
  const block = source.slice(source.indexOf("export async function updateGuestTemplate"))
  assert.match(block, /existing\.engine !== draft\.engine/)
  assert.match(block, /fingerprint\(existing\.operations\) !== fingerprint\(draft\.operations\)/)
  assert.match(block, /\.\.\.\(behaviourChanged \? \{ version: \{ increment: 1 \} \} : \{\}\)/)
  // A description is not in the fingerprint, so editing one leaves the version
  // alone — a version bump is the signal that provisioned servers were
  // configured by a different rule set.
  const fingerprintBody = source.slice(source.indexOf("const fingerprint"), source.indexOf("const behaviourChanged"))
  assert.ok(!/description/.test(fingerprintBody), "a description edit must not bump the version")
})

test("the save response says plainly what the version change means", () => {
  const source = read(PATCH_ROUTE)
  assert.match(source, /Servers already running keep the configuration they were given/)
})

// ---------------------------------------------------------------------------
// Testing
// ---------------------------------------------------------------------------

test("a dry run runs nothing and a real test records a result", () => {
  const source = read(TEST_ROUTE)
  assert.match(source, /if \(dryRun\) \{[\s\S]*?service\.previewOperation/)
  // A dry run is a reading, not a result: it must not overwrite the record of
  // what a real run proved.
  assert.match(source, /if \(!dryRun\) await recordTemplateTest/)
})

test("a template whose engine disagrees with the guest is refused before anything runs", () => {
  const source = read(TEST_ROUTE)
  assert.match(source, /ENGINE_MISMATCH/)
  assert.ok(
    source.indexOf("ENGINE_MISMATCH") < source.indexOf("service.testOperation"),
    "the engine check must come before the first real execution",
  )
})

test("a dangerous operation is never run by a test click alone", () => {
  for (const route of [TEST_ROUTE, OP_TEST_ROUTE]) {
    const source = read(route)
    assert.match(source, /confirmDestructive|confirmDangerous/, `${route} has no dangerous-operation guard`)
    assert.match(source, /requiresStopped|marked dangerous/)
  }
})

test("the OS is detected before a test runs, and a failure stops it", () => {
  for (const route of [TEST_ROUTE, OP_TEST_ROUTE]) {
    const source = read(route)
    assert.match(source, /service\.detectOs/)
    assert.match(source, /OS_DETECTION_UNAVAILABLE/)
    assert.ok(source.indexOf("detectOs") < source.indexOf("testOperation"), `${route} must detect the OS first`)
  }
})

test("an operation test refuses to substitute an empty value into a live command", () => {
  const source = read(OP_TEST_ROUTE)
  assert.match(source, /missingValues/)
  assert.match(source, /Supply them, or use a dry run/)
})

test("a dry run substitutes sample values and returns only the masked command", () => {
  const source = read(OP_TEST_ROUTE)
  assert.match(source, /dryRun: true/)
  // `resolved` is deliberately null when a secret is consumed over stdin; the
  // browser never receives a usable plaintext command.
  const service = read("lib/guest-automation/service.ts")
  const preview = service.slice(service.indexOf("async previewOperation"))
  assert.match(preview, /commandMasked: rendered\.ok \? rendered\.masked/)
  assert.match(preview, /resolved: rendered\.ok \? rendered\.resolved : null/)
  const sample = service.slice(service.indexOf("const SAMPLE_VALUES"))
  assert.match(sample, /sample-not-a-real-password/)
})

test("test results are audited without the command text", () => {
  const source = read(OP_TEST_ROUTE)
  const block = source.slice(source.indexOf('category: "Guest Automation"', source.indexOf("const tested")))
  assert.ok(block.length > 0)
  assert.ok(!/command:/.test(block), "a log containing the command text of a password or network operation leaks")
  assert.match(block, /runId/)
  assert.match(block, /verified/)
})

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

test("no route returns a rendered command with a real secret in it", () => {
  for (const route of [CREATE_ROUTE, PATCH_ROUTE, TEST_ROUTE, OP_TEST_ROUTE]) {
    const source = read(route)
    assert.ok(!/tokenSecret/.test(source.replace(/isEncryptedSecret[\s\S]*?decryptSecretValue/g, "")), `${route} handles a token secret it should not`)
  }
})

test("the API is admin-only on every route", () => {
  for (const route of [CREATE_ROUTE, PATCH_ROUTE, TEST_ROUTE, OP_TEST_ROUTE]) {
    const source = read(route)
    assert.match(source, /getAdminFromCookies/, `${route} has no admin check`)
    assert.match(source, /canAccessAdminApi/, `${route} has no role check`)
  }
})

test("the editor loads its vocabulary from the same place that validates it", () => {
  // Hard-coded dropdowns would drift from the rules and quietly offer an
  // operation the validator then rejects.
  const source = read(CREATE_ROUTE)
  assert.match(source, /view === "vocabulary"/)
  assert.match(source, /GUEST_OPERATIONS/)
  assert.match(source, /GUEST_VERIFICATION_PARSERS/)
  assert.match(source, /GUEST_PLACEHOLDERS/)
  const page = read(PAGE)
  assert.match(page, /view=vocabulary/)
  assert.ok(!page.includes("const OPERATIONS = ["), "the page must not hard-code the operation list")
})

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

test("the page refuses to save a template with structural problems, and shows them", () => {
  const source = read(PAGE)
  assert.match(source, /setStructural\(data\?\.structural \|\| \[\]\)/)
  assert.match(source, /setValidationErrors\(data\?\.errors \|\| \[\]\)/)
})

test("the page offers a dry run and a real test as separate actions", () => {
  const source = read(PAGE)
  assert.match(source, /onDryRun/)
  assert.match(source, /onRun\b/)
  assert.match(source, /Include dangerous operations/)
  assert.match(source, /nothing was executed/)
})

test("the health counters distinguish never-tested from failed", () => {
  const source = read(PAGE)
  for (const card of ["Templates", "Enabled", "Disabled", "Failed tests", "Never tested", "OS families", "Enabled operations", "Without operations"]) {
    assert.ok(source.includes(`label: "${card}"`), `the health row is missing "${card}"`)
  }
  // The matrix marks an operation that is defined but untested differently from
  // one that is not defined at all.
  assert.match(source, /untested/)
  assert.match(source, /Not tested|Never tested/)
})

test("an engine with no enabled template is called out", () => {
  const source = read(PAGE)
  assert.match(source, /missingEngines/)
  assert.match(source, /will be\s+?\n?\s*told it is unsupported/)
})

test("the sidebar exposes the page under Infrastructure", () => {
  const source = read("components/admin/admin-sidebar.tsx")
  assert.match(source, /href: "\/admin\/os-guest-automation"/)
  const infrastructure = source.slice(source.indexOf('label: "Infrastructure"'), source.indexOf('label: "Products & Sales"'))
  assert.ok(infrastructure.includes("os-guest-automation"), "the page must sit under Infrastructure")
})

// ---------------------------------------------------------------------------
// The guest-agent install hints
// ---------------------------------------------------------------------------

test("the install hint resolver matches families it does not have an exact key for", () => {
  assert.equal(guestAgentInstallCommands("debian").exact, true)
  assert.equal(guestAgentInstallCommands("kali").exact, true)
  assert.equal(guestAgentInstallCommands("rocky").exact, true)
  // An unknown family gets the Debian instructions with `exact: false`, so the
  // caller can say it is a guess rather than pretending to be certain.
  const guess = guestAgentInstallCommands("plan9")
  assert.equal(guess.exact, false)
  assert.ok(guess.commands.length > 0)
})

test("the hint resolver never returns nothing", () => {
  for (const family of ["", null, undefined, "debian", "windows", "alpine", "centos-7", "arch", "suse"]) {
    const result = guestAgentInstallCommands(family as any)
    assert.ok(result.commands.length > 0, `no install command for ${family}`)
  }
})
