/**
 * Template resolution.
 *
 * Given a detected OS, find the single best `GuestOSTemplate` and load its
 * operation definitions. This is the only place that maps "what the guest
 * reported" to "what commands we may run", which keeps the cross-OS guarantee
 * auditable in one file.
 *
 * Matching: `engine` must agree exactly, then the highest-`priority` enabled
 * template whose `osIds` contains the detected id, or whose `versionPattern`
 * matches the detected version, wins. A version-specific template beats a
 * family-wide one (higher priority is the admin's lever for that).
 *
 * Results are cached briefly because the provisioning pipeline resolves the same
 * template many times in a row, and the telemetry worker does it per VM per tick.
 */

import { prisma } from "@/lib/db"
import { GUEST_ERROR_MESSAGES, isGuestOperation, type GuestEngine, type GuestOperation } from "./constants"
import type { DetectedOs } from "./os-detection"

export type ResolvedOperation = {
  id: string
  operation: GuestOperation
  enabled: boolean
  commandType: string
  shell: string
  command: string | null
  arguments: unknown[]
  timeoutSeconds: number
  requiresRunning: boolean
  requiresStopped: boolean
  requiresGuestAgent: boolean
  rebootRequired: boolean
  dangerLevel: string
  requiresConfirmation: boolean
  supportsRollback: boolean
  verificationRequired: boolean
  verificationCommand: string | null
  verificationParser: string | null
  verificationArgs: Record<string, unknown> | null
  successCondition: string | null
  rollbackCommand: string | null
  rollbackArguments: unknown[] | null
  fallbacks: unknown[]
  stateKey: string | null
  notes: string | null
}

export type ResolvedTemplate = {
  id: string
  name: string
  slug: string
  family: string
  engine: GuestEngine
  version: number
  priority: number
  guestAgentRequired: boolean
  osIds: string[]
  versionPattern: string | null
  operations: Map<GuestOperation, ResolvedOperation>
}

export type ResolveTemplateResult =
  | { ok: true; template: ResolvedTemplate; matchedBy: "os-id" | "version-pattern" | "family" }
  | { ok: false; reason: string; code: "OS_DETECTION_UNAVAILABLE" | "OS_TEMPLATE_MISSING" | "OS_TEMPLATE_DISABLED" }

function osIdList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
  if (typeof value === "string") {
    return value
      .split(/[,\s]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  }
  return []
}

function safePattern(source: string | null | undefined): RegExp | null {
  if (!source) return null
  try {
    return new RegExp(source, "i")
  } catch {
    return null
  }
}

function mapOperation(row: any): ResolvedOperation {
  return {
    id: row.id,
    operation: row.operation,
    enabled: row.enabled,
    commandType: row.commandType,
    shell: row.shell,
    command: row.command,
    arguments: Array.isArray(row.arguments) ? row.arguments : [],
    timeoutSeconds: row.timeoutSeconds,
    requiresRunning: row.requiresRunning,
    requiresStopped: row.requiresStopped,
    requiresGuestAgent: row.requiresGuestAgent,
    rebootRequired: row.rebootRequired,
    dangerLevel: row.dangerLevel,
    requiresConfirmation: row.requiresConfirmation,
    supportsRollback: row.supportsRollback,
    verificationRequired: row.verificationRequired,
    verificationCommand: row.verificationCommand,
    verificationParser: row.verificationParser,
    verificationArgs: row.verificationArgs ?? null,
    successCondition: row.successCondition,
    rollbackCommand: row.rollbackCommand,
    rollbackArguments: Array.isArray(row.rollbackArguments) ? row.rollbackArguments : null,
    fallbacks: Array.isArray(row.fallbacks) ? row.fallbacks : [],
    stateKey: row.stateKey,
    notes: row.notes,
  }
}

/** Every enabled template, ordered the way matching prefers them. */
export async function loadCandidateTemplates(engine: GuestEngine) {
  return prisma.guestOSTemplate.findMany({
    where: { engine, enabled: true },
    include: { operations: true },
    orderBy: [{ priority: "desc" }, { name: "asc" }],
  })
}

function toResolved(row: any): ResolvedTemplate {
  const operations = new Map<GuestOperation, ResolvedOperation>()
  for (const operation of row.operations as any[]) {
    if (isGuestOperation(operation.operation)) {
      operations.set(operation.operation, mapOperation(operation))
    }
  }
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    family: row.family,
    engine: row.engine,
    version: row.version,
    priority: row.priority,
    guestAgentRequired: row.guestAgentRequired,
    osIds: osIdList(row.osIds),
    versionPattern: row.versionPattern,
    operations,
  }
}

/**
 * Score a candidate against the detected OS, or reject it.
 *
 * The one rule that matters: **a profile that states which versions it handles
 * does not handle the others.** `versionPattern` is the row's own claim about its
 * scope, so a guest outside that scope is not a weaker match — it is not a match.
 *
 * This was found against a real guest. A CentOS 7 clone resolved to the *RHEL 9*
 * profile, and would have been configured with RHEL 9 commands. It happened
 * because a version mismatch only cost 100 points while the profiles' priorities
 * differed by 110: `rhel-9` (declared `^9`, wrong for a CentOS 7 guest) scored
 * 200+310 = 510 and beat `centos-7` (declared `^7`, exactly right) on 300+200 =
 * 500. Scoring a mismatch instead of rejecting it means any profile can be
 * outvoted by a higher-priority profile that does not apply, which for a
 * configuration layer means running the wrong commands on a customer machine.
 *
 * Ranked, strongest claim first:
 *
 *   1. the os id is claimed and the version satisfies the declared pattern
 *   2. the version satisfies the pattern, under an alias id
 *   3. the os id is claimed but the version could not be checked — a profile whose
 *      `family` is the detected family is more specific than one that lists the
 *      id only as an alias
 *   4. an alias id with no version claim to test
 */
export function scoreTemplate(row: any, detected: DetectedOs): { score: number; matchedBy: "os-id" | "version-pattern" | "family" } | null {
  if (row.engine !== detected.engine) return null

  const ids = osIdList(row.osIds)
  const osId = (detected.osId || "").toLowerCase()
  const version = String(detected.version || "").trim()

  const exactId = Boolean(osId) && ids.includes(osId)
  const aliasId = Boolean(osId) && ids.some((id) => osId.startsWith(id) || id.startsWith(osId))
  if (!exactId && !aliasId) return null

  const pattern = safePattern(row.versionPattern)
  const versionKnown = version.length > 0
  const versionMatches = pattern ? (versionKnown ? pattern.test(version) : null) : null

  // Declared scope, enforced. No scoring shortcut past this.
  if (pattern && versionKnown && !versionMatches) return null

  // Ranked into tiers, with `priority` ordering only *within* a tier.
  //
  // Adding priority to a base score lets a far more specific profile be outvoted
  // by a broader one whenever priorities differ enough — which is the same
  // failure as the version mismatch above, one level up: a CentOS guest whose
  // version could not be read landed on whichever RHEL-family profile carried
  // the highest priority instead of the CentOS one. Specificity decides first;
  // priority decides between profiles of equal specificity, which is the only
  // thing a priority number can honestly mean here.
  const familySpecific = Boolean(row.family) && osFamilyFor(osId) === String(row.family).toLowerCase()
  const tier = exactId
    ? versionMatches ? 4 : familySpecific ? 2 : 1
    : versionMatches ? 3 : 0
  if (tier === 0 && !aliasId) return null

  const matchedBy: "os-id" | "version-pattern" | "family" = exactId ? "os-id" : versionMatches ? "version-pattern" : "family"
  return { score: tier * 1000 + (Number(row.priority) || 0), matchedBy }
}

/**
 * The family a guest id belongs to, for the specificity tie-break.
 *
 * Derived from the id itself rather than from the profile, so it is the same
 * answer whoever asks. Anything unrecognised maps to its own id, which compares
 * equal to no profile family and therefore adds no specificity — the correct
 * outcome for an OS nobody here has an opinion about.
 */
function osFamilyFor(osId: string): string {
  const known: Record<string, string> = {
    ubuntu: "ubuntu", debian: "debian", centos: "centos", "centos-stream": "centos",
    rhel: "rhel", redhat: "rhel", ol: "rhel", oracle: "rhel",
    rocky: "rhel", "rocky-linux": "rhel", almalinux: "rhel", alma: "rhel",
    fedora: "rhel", opensuse: "suse", sles: "suse", suse: "suse",
    arch: "arch", archlinux: "arch", alpine: "alpine", kali: "kali",
  }
  return known[osId] ?? osId
}

export async function resolveTemplate(
  detected: DetectedOs,
  options: { templateId?: string | null } = {},
): Promise<ResolveTemplateResult> {
  if (detected.kind === "unknown") {
    return { ok: false, reason: GUEST_ERROR_MESSAGES.OS_DETECTION_UNAVAILABLE, code: "OS_DETECTION_UNAVAILABLE" }
  }
  const engine = detected.engine as GuestEngine

  if (options.templateId) {
    // Explicit pin (admin test / already-adopted VM). Still engine-checked.
    const row = await prisma.guestOSTemplate.findUnique({ where: { id: options.templateId }, include: { operations: true } })
    if (!row) return { ok: false, reason: GUEST_ERROR_MESSAGES.OS_TEMPLATE_MISSING, code: "OS_TEMPLATE_MISSING" }
    if (row.engine !== engine) {
      return { ok: false, reason: `Template "${row.name}" targets ${row.engine} but the guest is ${engine}.`, code: "OS_TEMPLATE_MISSING" }
    }
    if (!row.enabled) return { ok: false, reason: GUEST_ERROR_MESSAGES.OS_TEMPLATE_DISABLED, code: "OS_TEMPLATE_DISABLED" }
    return { ok: true, template: toResolved(row), matchedBy: "os-id" }
  }

  const candidates = await loadCandidateTemplates(engine)
  if (!candidates.length) {
    return { ok: false, reason: GUEST_ERROR_MESSAGES.OS_TEMPLATE_MISSING, code: "OS_TEMPLATE_MISSING" }
  }

  let best: { row: any; score: number; matchedBy: "os-id" | "version-pattern" | "family" } | null = null
  for (const row of candidates) {
    const scored = scoreTemplate(row, detected)
    if (!scored) continue
    if (!best || scored.score > best.score) best = { row, score: scored.score, matchedBy: scored.matchedBy }
  }

  if (!best) {
    return {
      ok: false,
      reason: `${GUEST_ERROR_MESSAGES.OS_UNSUPPORTED} (detected: ${detected.osId || detected.name || "unknown"}${detected.version ? ` ${detected.version}` : ""})`,
      code: "OS_TEMPLATE_MISSING",
    }
  }
  return { ok: true, template: toResolved(best.row), matchedBy: best.matchedBy }
}

/** Look up one operation definition. Disabled rows are returned so callers can
 *  report `unsupported` with an explanation instead of a bare "not found". */
export function getOperation(template: ResolvedTemplate, operation: GuestOperation): ResolvedOperation | null {
  return template.operations.get(operation) ?? null
}

/** Enabled operations in a stable, safe execution order. */
export function enabledOperations(template: ResolvedTemplate, order?: GuestOperation[]): ResolvedOperation[] {
  const all = [...template.operations.values()].filter((row) => row.enabled)
  if (!order) return all
  const rank = new Map(order.map((op, index) => [op as string, index]))
  return all.sort((a, b) => (rank.get(a.operation) ?? 999) - (rank.get(b.operation) ?? 999))
}

/** Health summary for the admin Templates page. */
export async function templateHealthSummary() {
  const [templates, failedTests] = await Promise.all([
    prisma.guestOSTemplate.findMany({
      include: { operations: { select: { id: true, enabled: true, operation: true, dangerLevel: true } }, _count: { select: { vms: true } } },
      orderBy: [{ enabled: "desc" }, { engine: "asc" }, { priority: "desc" }],
    }),
    prisma.guestOSTemplate.findMany({
      where: { lastTestResult: { path: ["status"], equals: "failed" } },
      select: { id: true },
    }),
  ])
  const enabled = templates.filter((row) => row.enabled)
  const operationCount = enabled.reduce((total, row) => total + row.operations.filter((op) => op.enabled).length, 0)
  return {
    total: templates.length,
    enabled: enabled.length,
    disabled: templates.length - enabled.length,
    failedTests: failedTests.length,
    operations: operationCount,
    templates,
  }
}
