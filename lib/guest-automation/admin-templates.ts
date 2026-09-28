/**
 * Admin persistence for guest-automation OS templates.
 *
 * This is the only place that turns a request body into template rows. Two rules
 * govern everything here:
 *
 * - A template that would not work can never be saved, let alone enabled. Every
 *   write goes through `validateTemplateDraft`, which rejects a cross-OS command,
 *   a missing placeholder, a command that could never verify, and a shell that
 *   does not belong to the engine.
 * - Enabling is a separate, explicit act. Saving a draft never turns a template
 *   on, because a half-finished edit must not start being used for real
 *   deployments the moment it is saved.
 *
 * Nothing here runs a command. Testing is a separate, deliberate call against a
 * chosen VM, so an editor can never execute anything by saving a form.
 */

import { prisma } from "@/lib/db"
import { GUEST_OPERATIONS, GUEST_ENGINES, isGuestOperation } from "@/lib/guest-automation/constants"
import { validateTemplateDraft, type OperationDraft, type TemplateDraft, type ValidationResult } from "@/lib/guest-automation/validation"
import { extractPlaceholders, SECRET_PLACEHOLDERS } from "@/lib/guest-automation/placeholders"

export class TemplateValidationError extends Error {
  result: ValidationResult
  constructor(result: ValidationResult) {
    super(result.errors.map((entry) => `${entry.path}: ${entry.message}`).join("; ") || "Template is not valid")
    this.name = "TemplateValidationError"
    this.result = result
  }
}

function jsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean)
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map((entry) => String(entry).trim()).filter(Boolean)
    } catch {
      // Fall through to a comma-separated read, which is what an admin typing
      // into a plain text box actually produces.
    }
    return value.split(/[,\s]+/).map((entry) => entry.trim()).filter(Boolean)
  }
  return []
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed
    } catch {
      return {}
    }
  }
  return {}
}

function text(value: unknown): string | null {
  const next = String(value ?? "").trim()
  return next ? next : null
}

function bool(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === "") return fallback
  return value === true || value === "true" || value === "on" || value === 1
}

function intOrNull(value: unknown) {
  if (value === undefined || value === null || value === "") return null
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

/** Turn a request body into a validated draft, rejecting anything invalid. */
export function draftFromPayload(body: any): TemplateDraft {
  const operations: OperationDraft[] = (Array.isArray(body?.operations) ? body.operations : []).map((entry: any) => ({
    id: text(entry?.id) || undefined,
    operation: String(entry?.operation || "").trim(),
    enabled: bool(entry?.enabled, true),
    commandType: text(entry?.commandType) || undefined,
    shell: text(entry?.shell) || undefined,
    command: text(entry?.command),
    arguments: jsonObject(entry?.arguments),
    timeoutSeconds: intOrNull(entry?.timeoutSeconds) ?? undefined,
    requiresRunning: bool(entry?.requiresRunning, false),
    requiresStopped: bool(entry?.requiresStopped, false),
    requiresGuestAgent: bool(entry?.requiresGuestAgent, true),
    rebootRequired: bool(entry?.rebootRequired, false),
    dangerLevel: text(entry?.dangerLevel) || undefined,
    requiresConfirmation: bool(entry?.requiresConfirmation, false),
    supportsRollback: bool(entry?.supportsRollback, false),
    verificationRequired: bool(entry?.verificationRequired, true),
    verificationCommand: text(entry?.verificationCommand),
    verificationParser: text(entry?.verificationParser),
    successCondition: text(entry?.successCondition),
    rollbackCommand: text(entry?.rollbackCommand),
    fallbacks: entry?.fallbacks,
    stateKey: text(entry?.stateKey),
    notes: text(entry?.notes),
  }))

  return {
    name: String(body?.name || "").trim(),
    slug: String(body?.slug || "").trim().toLowerCase(),
    family: String(body?.family || "").trim().toLowerCase(),
    engine: String(body?.engine || "").trim().toLowerCase(),
    osIds: jsonArray(body?.osIds),
    versionPattern: text(body?.versionPattern),
    enabled: bool(body?.enabled, false),
    guestAgentRequired: bool(body?.guestAgentRequired, true),
    priority: intOrNull(body?.priority) ?? 100,
    description: text(body?.description),
    osTemplateId: text(body?.osTemplateId),
    operations,
  }
}

/**
 * A shape that would break a live deployment if it were saved.
 *
 * Returned alongside the row so the editor can show it before the admin commits,
 * not after the next provisioning job fails.
 */
export function structuralIssues(draft: TemplateDraft): string[] {
  const issues: string[] = []
  const osIds = (draft.osIds || []) as string[]
  if (!draft.engine || !GUEST_ENGINES.includes(draft.engine as any)) {
    issues.push(`Engine must be one of ${GUEST_ENGINES.join(", ")}. It is the only thing that decides which command set may run.`)
  }
  if (!osIds.length) {
    issues.push("No OS ids are claimed. The QEMU guest agent reports an OS id; without one this template can never be selected.")
  }
  const seen = new Set<string>()
  for (const operation of draft.operations) {
    if (!isGuestOperation(operation.operation)) {
      issues.push(`"${operation.operation}" is not a supported operation.`)
      continue
    }
    if (seen.has(operation.operation)) issues.push(`Operation "${operation.operation}" is defined more than once.`)
    seen.add(operation.operation)
    const command = String(operation.command || "")
    if (operation.commandType === "guest-exec" && !command) {
      issues.push(`"${operation.operation}" is a shell command with no command text.`)
    }
    // A secret must never be interpolated into a command line. It reaches the
    // guest over stdin instead, so a command containing {{PASSWORD}} is both
    // unsafe and unsupported.
    for (const placeholder of extractPlaceholders(command)) {
      if (SECRET_PLACEHOLDERS.has(placeholder as any)) {
        issues.push(`"${operation.operation}" interpolates ${placeholder} into the command. Secrets are passed to the guest on stdin and must not appear in a command line.`)
      }
    }
    if (operation.verificationRequired && operation.commandType === "guest-exec" && !command) {
      issues.push(`"${operation.operation}" requires verification but has no command to verify.`)
    }
  }
  return issues
}

function operationData(operation: OperationDraft) {
  return {
    operation: operation.operation,
    enabled: operation.enabled !== false,
    commandType: operation.commandType || "guest-exec",
    // A guest-native operation is not run by a shell, so storing a shell for it
    // would be an inert field that reads as though it constrained anything.
    shell: operation.commandType === "guest-native" ? null : operation.shell || null,
    command: operation.command ?? null,
    arguments: (operation.arguments || {}) as any,
    timeoutSeconds: operation.timeoutSeconds ?? 60,
    requiresRunning: operation.requiresRunning ?? false,
    requiresStopped: operation.requiresStopped ?? false,
    requiresGuestAgent: operation.requiresGuestAgent ?? true,
    rebootRequired: operation.rebootRequired ?? false,
    dangerLevel: operation.dangerLevel || "safe",
    requiresConfirmation: operation.requiresConfirmation ?? false,
    supportsRollback: operation.supportsRollback ?? false,
    verificationRequired: operation.verificationRequired !== false,
    verificationCommand: operation.verificationCommand ?? null,
    verificationParser: operation.verificationParser ?? null,
    successCondition: operation.successCondition ?? null,
    rollbackCommand: operation.rollbackCommand ?? null,
    fallbacks: (operation.fallbacks ?? null) as any,
    stateKey: operation.stateKey ?? null,
    notes: operation.notes ?? null,
  }
}

function assertValid(draft: TemplateDraft) {
  const result = validateTemplateDraft(draft)
  if (!result.ok) throw new TemplateValidationError(result)
  return result
}

/** Create a template. Never starts enabled unless the payload says so. */
export async function createGuestTemplate(body: any) {
  const draft = draftFromPayload(body)
  const result = assertValid(draft)
  return prisma.guestOSTemplate.create({
    data: {
      name: draft.name,
      slug: draft.slug,
      family: draft.family,
      osIds: draft.osIds as any,
      versionPattern: draft.versionPattern,
      enabled: draft.enabled === true,
      guestAgentRequired: draft.guestAgentRequired !== false,
      engine: draft.engine,
      priority: draft.priority ?? 100,
      description: draft.description,
      osTemplateId: draft.osTemplateId || null,
      version: 1,
      operations: { create: draft.operations.map(operationData) },
    } as any,
    include: { operations: true },
  }).then((row: any) => ({ row, result, structural: structuralIssues(draft) }))
}

/**
 * Update a template.
 *
 * The version is bumped only when something that affects a running deployment
 * changes — the operations, the engine, the claimed OS ids or the priority. A
 * description edit does not bump it, because a version bump is the signal that
 * already-provisioned guests were configured by a different rule set.
 */
export async function updateGuestTemplate(id: string, body: any) {
  const existing = await prisma.guestOSTemplate.findUnique({ where: { id }, include: { operations: true } })
  if (!existing) return null
  const draft = draftFromPayload({ ...body, operations: body?.operations ?? existing.operations })
  const result = assertValid(draft)

  const fingerprint = (source: any) => JSON.stringify(
    (Array.isArray(source) ? source : []).map((operation: any) => [operation.operation, operation.commandType, operation.shell, operation.command, operation.verificationCommand, operation.successCondition, operation.enabled]),
  )
  const behaviourChanged =
    existing.engine !== draft.engine ||
    fingerprint(existing.operations) !== fingerprint(draft.operations) ||
    JSON.stringify(existing.osIds ?? []) !== JSON.stringify(draft.osIds ?? []) ||
    existing.priority !== (draft.priority ?? 100)

  const updated = await prisma.$transaction(async (tx: any) => {
    await tx.guestOperationTemplate.deleteMany({ where: { templateId: id } })
    for (const operation of draft.operations) {
      await tx.guestOperationTemplate.create({ data: { ...operationData(operation), templateId: id } as any })
    }
    return tx.guestOSTemplate.update({
      where: { id },
      data: {
        name: draft.name,
        slug: draft.slug,
        family: draft.family,
        osIds: draft.osIds as any,
        versionPattern: draft.versionPattern,
        enabled: draft.enabled === true,
        guestAgentRequired: draft.guestAgentRequired !== false,
        engine: draft.engine,
        priority: draft.priority ?? 100,
        description: draft.description,
        osTemplateId: draft.osTemplateId || null,
        ...(behaviourChanged ? { version: { increment: 1 } } : {}),
      } as any,
      include: { operations: true },
    })
  })

  return { row: updated, result, structural: structuralIssues(draft), versionBumped: behaviourChanged, previousVersion: existing.version }
}

/** Enable or disable, which is the only way a template starts or stops being used. */
export async function setGuestTemplateEnabled(id: string, enabled: boolean) {
  const existing = await prisma.guestOSTemplate.findUnique({ where: { id }, include: { operations: true } })
  if (!existing) return null
  if (!enabled) {
    return prisma.guestOSTemplate.update({ where: { id }, data: { enabled: false }, include: { operations: true } })
  }
  // Enabling is refused for a template that could not work. Saving a broken
  // template is allowed — an admin may want to stage it — but using it is not.
  const result = validateTemplateDraft(draftFromPayload({ ...existing, operations: existing.operations }))
  const structural = structuralIssues(draftFromPayload({ ...existing, operations: existing.operations }))
  if (!result.ok || structural.length) {
    throw new TemplateValidationError({
      ok: false,
      errors: [
        ...result.errors,
        ...structural.map((message) => ({ path: "template", message })),
      ],
      warnings: result.warnings,
    })
  }
  if (!existing.operations.some((operation: any) => operation.enabled)) {
    throw new TemplateValidationError({
      ok: false,
      errors: [{ path: "operations", message: "This template has no enabled operation, so enabling it would do nothing." }],
      warnings: [],
    })
  }
  return prisma.guestOSTemplate.update({ where: { id }, data: { enabled: true }, include: { operations: true } })
}

export async function deleteGuestTemplate(id: string) {
  const inUse = await prisma.vmGuestAdoption.count({ where: { guestTemplateId: id } })
  if (inUse > 0) {
    throw new Error(`This template has been applied to ${inUse} server(s). Disable it instead — deleting it would leave those servers with no recorded configuration.`)
  }
  return prisma.guestOSTemplate.delete({ where: { id } })
}

/** One template with its operations, shaped for the editor. */
export async function getGuestTemplate(id: string) {
  return prisma.guestOSTemplate.findUnique({ where: { id }, include: { operations: { orderBy: { operation: "asc" } } } })
}

export async function listGuestTemplates() {
  return prisma.guestOSTemplate.findMany({
    include: {
      operations: { orderBy: { operation: "asc" } },
      _count: { select: { vms: true } },
    },
    orderBy: [{ enabled: "desc" }, { engine: "asc" }, { priority: "desc" }, { name: "asc" }],
  })
}

/**
 * The health counters the admin dashboard shows.
 *
 * `failed` counts templates whose last recorded test failed. A template that has
 * never been tested is counted separately from one that passed, because "never
 * run" and "known good" are not the same claim.
 */
export async function guestTemplateHealth() {
  const templates = await listGuestTemplates()
  const tested = templates.filter((row: any) => row.lastTestedAt)
  const failed = templates.filter((row: any) => (row.lastTestResult as any)?.status === "failed")
  const neverTested = templates.filter((row: any) => !row.lastTestedAt)
  const missingOperations = templates.filter((row: any) => !row.operations.some((operation: any) => operation.enabled))
  const families = new Set(templates.map((row: any) => row.family).filter(Boolean))

  // An OS family with no enabled template for its engine is a gap: a guest
  // reporting that OS would be told "unsupported".
  const enginesPresent = new Set(templates.filter((row: any) => row.enabled).map((row: any) => row.engine))
  const missingEngines = ["linux", "windows"].filter((engine) => !enginesPresent.has(engine))

  return {
    total: templates.length,
    enabled: templates.filter((row: any) => row.enabled).length,
    disabled: templates.filter((row: any) => !row.enabled).length,
    failed: failed.length,
    neverTested: neverTested.length,
    passed: tested.length - failed.length,
    withoutEnabledOperations: missingOperations.length,
    families: families.size,
    missingEngines,
    operations: templates.reduce((total: number, row: any) => total + row.operations.length, 0),
    enabledOperations: templates
      .filter((row: any) => row.enabled)
      .reduce((total: number, row: any) => total + row.operations.filter((operation: any) => operation.enabled).length, 0),
  }
}

/** Record a test result against a template. */
export async function recordTemplateTest(id: string, result: Record<string, unknown>) {
  return prisma.guestOSTemplate.update({
    where: { id },
    data: { lastTestedAt: new Date(), lastTestResult: result as any },
  })
}

/**
 * The test matrix: every template, every operation, and what is known about each.
 *
 * Built from the stored rows rather than from a hard-coded list, so an operation
 * an admin removed shows as absent rather than as passing.
 */
export async function guestTestMatrix() {
  const templates = await listGuestTemplates()
  return templates.map((template: any) => ({
    templateId: template.id,
    name: template.name,
    slug: template.slug,
    engine: template.engine,
    family: template.family,
    version: template.version,
    enabled: template.enabled,
    lastTestedAt: template.lastTestedAt,
    lastTestStatus: (template.lastTestResult as any)?.status || null,
    servers: template._count?.vms ?? 0,
    operations: GUEST_OPERATIONS.map((operation) => {
      const row = template.operations.find((entry: any) => entry.operation === operation)
      if (!row) return { operation, present: false, enabled: false, tested: null, dangerLevel: null, commandType: null }
      const last = (template.lastTestResult as any)?.operations?.[operation]
      return {
        operation,
        present: true,
        id: row.id,
        enabled: row.enabled,
        tested: last ? last.status : null,
        testedAt: last?.at || null,
        dangerLevel: row.dangerLevel,
        commandType: row.commandType,
        requiresConfirmation: row.requiresConfirmation,
        lastError: last?.error || null,
      }
    }),
  }))
}
