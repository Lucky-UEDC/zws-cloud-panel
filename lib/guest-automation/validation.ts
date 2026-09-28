/**
 * Template validation.
 *
 * A broken template must never reach an enabled state, because an enabled
 * template is executable on customer VMs. Validation therefore checks:
 *  - identifier shape (slug, family, osIds, versionPattern)
 *  - engine/shell agreement
 *  - operation name is in the allowed vocabulary
 *  - command body is non-empty, engine-appropriate, and free of cross-OS tokens
 *  - timeouts and danger levels are sane
 *  - dangerous operations declare a rollback or explicitly opt out
 *  - the operation's own required placeholders are all satisfiable
 */

import {
  GUEST_ERROR_MESSAGES,
  GUEST_OPERATIONS,
  crossOsCommandViolations,
  engineForShell,
  isGuestCommandType,
  isGuestDangerLevel,
  isGuestOperation,
  isGuestShell,
  isGuestVerificationParser,
  type GuestEngine,
  type GuestOperation,
} from "./constants"
import { extractPlaceholders, unknownPlaceholders } from "./placeholders"
import { assertNativeVerbAllowed } from "./proxmox-guest"

export type OperationDraft = {
  id?: string
  operation: string
  enabled?: boolean
  commandType?: string
  shell?: string
  command?: string | null
  arguments?: unknown
  timeoutSeconds?: number
  requiresRunning?: boolean
  requiresStopped?: boolean
  requiresGuestAgent?: boolean
  rebootRequired?: boolean
  dangerLevel?: string
  requiresConfirmation?: boolean
  supportsRollback?: boolean
  verificationRequired?: boolean
  verificationCommand?: string | null
  verificationParser?: string | null
  successCondition?: string | null
  rollbackCommand?: string | null
  fallbacks?: unknown
  stateKey?: string | null
  notes?: string | null
}

export type TemplateDraft = {
  name: string
  slug: string
  family: string
  engine: string
  osIds?: unknown
  versionPattern?: string | null
  enabled?: boolean
  guestAgentRequired?: boolean
  priority?: number
  description?: string | null
  osTemplateId?: string | null
  operations: OperationDraft[]
}

export type ValidationIssue = { path: string; message: string }
export type ValidationResult = { ok: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[] }

const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/
const FAMILY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/
const MAX_COMMAND_LENGTH = 4_000
const MAX_TIMEOUT_SECONDS = 900

function issue(path: string, message: string): ValidationIssue {
  return { path, message }
}

function parseOsIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
  if (typeof value === "string") {
    return value
      .split(/[,\s]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  }
  return []
}

/**
 * Placeholders a given operation genuinely needs in its command body.
 *
 * `PASSWORD` is deliberately absent everywhere: passwords are delivered on the
 * command's stdin, so a template that inlines `{{PASSWORD}}` would put the
 * plaintext into argv and the Proxmox task log.
 */
const REQUIRED_PLACEHOLDERS: Partial<Record<GuestOperation, string[]>> = {
  set_ip: ["IP", "PREFIX", "GATEWAY"],
  set_gateway: ["GATEWAY"],
  set_dns: ["DNS1"],
  set_password: ["USERNAME"],
  create_user: ["USERNAME"],
  update_user: ["USERNAME"],
  enable_user: ["USERNAME"],
  disable_user: ["USERNAME"],
  delete_user: ["USERNAME"],
  set_hostname: ["HOSTNAME"],
  timezone: ["TIMEZONE"],
}

function validateOperation(draft: OperationDraft, engine: GuestEngine, index: number): ValidationIssue[] {
  const errors: ValidationIssue[] = []
  const path = `operations[${index}]`

  if (!isGuestOperation(draft.operation)) {
    errors.push(issue(`${path}.operation`, `"${draft.operation}" is not a supported operation.`))
    return errors
  }
  const operation = draft.operation
  const commandType = draft.commandType ?? "guest-exec"
  const shell = draft.shell ?? (engine === "windows" ? "windows-powershell" : "linux-sh")

  if (!isGuestCommandType(commandType)) {
    errors.push(issue(`${path}.commandType`, `Command type must be guest-native or guest-exec.`))
  }
  if (!isGuestShell(shell)) {
    errors.push(issue(`${path}.shell`, `Unknown shell "${shell}".`))
    return errors
  }

  const shellEngine = engineForShell(shell)
  if (shellEngine !== engine && commandType === "guest-exec") {
    // Only a `guest-exec` operation actually goes through a shell. A
    // `guest-native` verb is handed straight to the agent as a verb name, so
    // the stored shell value is inert and must not be judged against the
    // engine — otherwise every shared native op (get-osinfo, get-fsinfo, …)
    // would be rejected in a Windows template.
    errors.push(
      issue(
        `${path}.shell`,
        `Shell "${shell}" is a ${shellEngine} shell but the template engine is "${engine}". A ${engine} template cannot use a ${shellEngine} shell.`,
      ),
    )
  }

  const timeout = Number(draft.timeoutSeconds ?? 30)
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > MAX_TIMEOUT_SECONDS) {
    errors.push(issue(`${path}.timeoutSeconds`, `Timeout must be between 1 and ${MAX_TIMEOUT_SECONDS} seconds.`))
  }

  if (!isGuestDangerLevel(draft.dangerLevel ?? "safe")) {
    errors.push(issue(`${path}.dangerLevel`, `Danger level must be safe, caution, or dangerous.`))
  }

  if (draft.verificationRequired !== false && draft.verificationParser && !isGuestVerificationParser(draft.verificationParser)) {
    errors.push(issue(`${path}.verificationParser`, `Unknown verification parser "${draft.verificationParser}".`))
  }

  if (commandType === "guest-native") {
    const verb = String(draft.command || "").trim()
    if (!verb) {
      errors.push(issue(`${path}.command`, `A guest-native operation must name its qm guest verb (for example get-osinfo).`))
    } else {
      const allowed = assertNativeVerbAllowed(verb, engine)
      if (!allowed.ok) errors.push(issue(`${path}.command`, allowed.error))
    }
  } else {
    const command = String(draft.command || "").trim()
    if (!command) {
      errors.push(issue(`${path}.command`, `A guest-exec operation must define a command.`))
    } else {
      if (command.length > MAX_COMMAND_LENGTH) {
        errors.push(issue(`${path}.command`, `Command exceeds ${MAX_COMMAND_LENGTH} characters.`))
      }
      const violations = crossOsCommandViolations(command, engine)
      if (violations.length) {
        errors.push(
          issue(`${path}.command`, `Command contains ${engine === "linux" ? "Windows" : "Linux"} tokens and cannot run on a ${engine} guest: ${violations.join(", ")}.`),
        )
      }
      for (const unknown of unknownPlaceholders(command)) {
        errors.push(issue(`${path}.command`, `Unknown placeholder {{${unknown}}}.`))
      }
    }
  }

  if (draft.requiresRunning && draft.requiresStopped) {
    errors.push(issue(`${path}.requiresRunning`, `An operation cannot require both a running and a stopped VM.`))
  }

  const danger = draft.dangerLevel ?? "safe"
  if (danger === "dangerous" && !draft.requiresConfirmation) {
    errors.push(issue(`${path}.requiresConfirmation`, `Dangerous operations must require explicit confirmation.`))
  }
  if (danger === "dangerous" && draft.supportsRollback && !String(draft.rollbackCommand || "").trim()) {
    errors.push(issue(`${path}.rollbackCommand`, `Rollback is declared but no rollback command is defined.`))
  }

  const required = REQUIRED_PLACEHOLDERS[operation] ?? []
  if (commandType === "guest-exec") {
    const used = new Set(extractPlaceholders(String(draft.command || "")))
    for (const name of required) {
      if (!used.has(name)) {
        errors.push(issue(`${path}.command`, `Operation "${operation}" must use the {{${name}}} placeholder.`))
      }
    }
  }

  if (draft.stateKey && !/^[a-z0-9]+(?:[._][a-z0-9]+)*$/i.test(draft.stateKey)) {
    errors.push(issue(`${path}.stateKey`, `State key must be a dotted identifier (for example network.ipv4).`))
  }

  return errors
}

export function validateTemplateDraft(draft: TemplateDraft): ValidationResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  const name = String(draft.name || "").trim()
  if (name.length < 2) errors.push(issue("name", "Template name is required."))

  const slug = String(draft.slug || "").trim().toLowerCase()
  if (!SLUG_PATTERN.test(slug)) {
    errors.push(issue("slug", "Slug must be lowercase letters, digits, dot, dash, or underscore (2-64 characters)."))
  }

  const family = String(draft.family || "").trim().toLowerCase()
  if (!FAMILY_PATTERN.test(family)) {
    errors.push(issue("family", "Family must be a short lowercase identifier such as ubuntu or windows."))
  }

  const engine = draft.engine as GuestEngine
  if (engine !== "linux" && engine !== "windows") {
    errors.push(issue("engine", "Engine must be linux or windows."))
  }

  const osIds = parseOsIds(draft.osIds)
  if (!osIds.length) {
    errors.push(issue("osIds", "At least one guest OS id is required (the value reported by get-osinfo)."))
  }
  for (const id of osIds) {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
      errors.push(issue("osIds", `"${id}" is not a valid OS id.`))
    }
  }

  if (draft.versionPattern) {
    try {
      // eslint-disable-next-line no-new
      new RegExp(String(draft.versionPattern))
    } catch {
      errors.push(issue("versionPattern", "Version pattern is not a valid regular expression."))
    }
  }

  if (!Array.isArray(draft.operations) || draft.operations.length === 0) {
    errors.push(issue("operations", "Define at least one operation."))
  } else {
    const seen = new Set<string>()
    draft.operations.forEach((operation, index) => {
      if (isGuestOperation(operation.operation) && seen.has(operation.operation)) {
        errors.push(issue(`operations[${index}].operation`, `Operation "${operation.operation}" is defined twice.`))
      }
      if (isGuestOperation(operation.operation)) seen.add(operation.operation)
      if (engine === "linux" || engine === "windows") {
        errors.push(...validateOperation(operation, engine, index))
      }
    })
  }

  if (draft.enabled) {
    const disk = (draft.operations || []).find((operation) => operation.operation === "disk_usage" && operation.enabled !== false)
    if (!disk) {
      warnings.push(issue("operations", "No enabled disk_usage operation: disk telemetry will be unavailable for this OS."))
    }
  }

  if (draft.priority !== undefined && !Number.isFinite(Number(draft.priority))) {
    errors.push(issue("priority", "Priority must be a number."))
  }

  return { ok: errors.length === 0, errors, warnings }
}

/** Values a `guest-exec` operation will need, surfaced for the dry-run preview. */
export function requiredValuesForOperation(operation: string, command: string | null | undefined): string[] {
  if (!command) return REQUIRED_PLACEHOLDERS[operation as GuestOperation] ?? []
  const used = new Set(extractPlaceholders(command))
  return [...used].sort()
}

/** Placeholder catalogue for the admin editor. */
export const OPERATION_VOCABULARY = GUEST_OPERATIONS
