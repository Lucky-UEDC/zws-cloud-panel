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

/** Score a candidate against the detected OS. Higher is better, 0 = no match. */
export function scoreTemplate(row: any, detected: DetectedOs): { score: number; matchedBy: "os-id" | "version-pattern" | "family" } | null {
  if (row.engine !== detected.engine) return null

  const ids = osIdList(row.osIds)
  const osId = (detected.osId || "").toLowerCase()
  const version = detected.version || ""

  // Version-specific match on the exact os id is the strongest signal.
  if (osId && ids.includes(osId)) {
    const pattern = safePattern(row.versionPattern)
    if (pattern && version) {
      return pattern.test(version) ? { score: 300 + row.priority, matchedBy: "os-id" } : { score: 200 + row.priority, matchedBy: "os-id" }
    }
    return { score: 250 + row.priority, matchedBy: "os-id" }
  }

  // Alias coverage: an os id may be claimed via prefix (e.g. "rocky" vs
  // "rocky-linux") without being a literal match.
  if (osId && ids.some((id) => osId.startsWith(id) || id.startsWith(osId))) {
    return { score: 150 + row.priority, matchedBy: "family" }
  }

  const pattern = safePattern(row.versionPattern)
  if (pattern && version && ids.length === 0) {
    return pattern.test(version) ? { score: 120 + row.priority, matchedBy: "version-pattern" } : null
  }

  return null
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
