/**
 * Operation planning and change detection.
 *
 * A plan is the ordered list of operations a guest mutation will execute, built
 * from the requested change plus the guest's observed state. Two properties
 * matter:
 *
 *  1. Change-driven, not replay-driven. Changing DNS must not rewrite the IP,
 *     the gateway, the hostname, or the password. Only the affected operation
 *     is planned, and only that one runs.
 *  2. Idempotent. Each step carries a `stateKey`; when the observed state
 *     already satisfies the expectation the step is marked `skipped` with
 *     reason `already_applied` and never executed.
 */

import { FIRST_BOOT_SEQUENCE, NETWORK_OPERATIONS, NON_IDEMPOTENT_OPERATIONS, type GuestOperation, type GuestOperationStatus } from "./constants"
import { parseNativeInterfaces, type ParsedNetwork } from "./parsers"
import type { DetectedOs } from "./os-detection"
import type { ResolvedOperation, ResolvedTemplate } from "./template-resolver"

export type GuestStateSnapshot = {
  interfaces: ParsedNetwork["interfaces"]
  primaryInterface: string | null
  ipv4: string[]
  hostname: string | null
  username: string | null
  users: string[]
  gateway: string | null
  dns: string[]
  timezone: string | null
  diskMounts: string[]
  collectedAt: number
}

export const EMPTY_SNAPSHOT: GuestStateSnapshot = {
  interfaces: [],
  primaryInterface: null,
  ipv4: [],
  hostname: null,
  username: null,
  users: [],
  gateway: null,
  dns: [],
  timezone: null,
  diskMounts: [],
  collectedAt: 0,
}

export type PlannedOperation = {
  operation: GuestOperation
  status: GuestOperationStatus
  /** Why the operation is in the plan. */
  reason: string
  changed: boolean
  template: ResolvedOperation | null
  /** Placeholder values resolved from the request. */
  values: Record<string, string>
  /**
   * Secret to deliver on the command's stdin, kept in memory only. It is never
   * written to the plan row, the audit log, or the operation-run record.
   */
  stdinSecret?: string | null
  /** Old values captured for rollback. */
  previous: Record<string, unknown>
  dangerous: boolean
  requiresRunning: boolean
  requiresStopped: boolean
  verificationRequired: boolean
  supportsRollback: boolean
  rebootRequired: boolean
}

export type OperationPlan = {
  vmid: number
  operations: PlannedOperation[]
  detected: DetectedOs
  template: ResolvedTemplate
  /** True when the guest already satisfies everything requested. */
  noChange: boolean
}

export type PlanRequest = {
  vmid: number
  detected: DetectedOs
  template: ResolvedTemplate
  snapshot: GuestStateSnapshot
  /** What the caller wants changed. Absent key = "leave alone". */
  desired: {
    ip?: string
    prefix?: number
    gateway?: string
    dns?: string[]
    searchDomain?: string
    hostname?: string
    username?: string
    password?: string
    timezone?: string
    createUser?: { username: string; password: string }
    diskMount?: string
  }
  /** first_boot runs the full sequence; a change runs only what differs. */
  mode: "first_boot" | "change"
}

function definitionFor(template: ResolvedTemplate, operation: GuestOperation): ResolvedOperation | null {
  return template.operations.get(operation) ?? null
}

function base(operation: GuestOperation, definition: ResolvedOperation | null, reason: string, values: Record<string, string> = {}): PlannedOperation {
  return {
    operation,
    status: definition ? "pending" : "skipped",
    reason: definition ? reason : `No ${definition === null ? "" : ""}operation defined for this operating system.`,
    changed: false,
    template: definition,
    values,
    previous: {},
    dangerous: definition?.dangerLevel === "dangerous",
    requiresRunning: definition?.requiresRunning ?? true,
    requiresStopped: definition?.requiresStopped ?? false,
    verificationRequired: definition?.verificationRequired ?? true,
    supportsRollback: definition?.supportsRollback ?? false,
    rebootRequired: definition?.rebootRequired ?? false,
  }
}

function alreadyMatches(snapshot: GuestStateSnapshot, operation: GuestOperation, desired: PlanRequest["desired"]): { matches: boolean; previous: Record<string, unknown> } {
  switch (operation) {
    case "set_ip": {
      if (!desired.ip) return { matches: false, previous: {} }
      const matches = snapshot.ipv4.includes(desired.ip)
      return { matches, previous: { ipv4: snapshot.ipv4, primaryInterface: snapshot.primaryInterface } }
    }
    case "set_gateway": {
      if (!desired.gateway) return { matches: false, previous: {} }
      return { matches: snapshot.gateway === desired.gateway, previous: { gateway: snapshot.gateway } }
    }
    case "set_dns": {
      const want = (desired.dns ?? []).filter(Boolean).sort()
      if (!want.length) return { matches: false, previous: {} }
      const have = [...snapshot.dns].sort()
      return { matches: want.length === have.length && want.every((value, index) => value === have[index]), previous: { dns: snapshot.dns } }
    }
    case "set_hostname": {
      if (!desired.hostname) return { matches: false, previous: {} }
      return {
        matches: (snapshot.hostname || "").toLowerCase() === desired.hostname.toLowerCase(),
        previous: { hostname: snapshot.hostname },
      }
    }
    case "create_user": {
      if (!desired.createUser) return { matches: false, previous: {} }
      return { matches: snapshot.users.includes(desired.createUser.username), previous: { users: snapshot.users } }
    }
    case "timezone": {
      if (!desired.timezone) return { matches: false, previous: {} }
      return { matches: (snapshot.timezone || "").toUpperCase() === desired.timezone.toUpperCase(), previous: { timezone: snapshot.timezone } }
    }
    case "set_password":
      // A password hash is never readable through the guest API, so we cannot
      // prove the current value. Idempotency is not claimed; it is re-applied.
      return { matches: false, previous: { username: desired.username ?? snapshot.username } }
    default:
      return { matches: false, previous: {} }
  }
}

/**
 * Build the ordered plan.
 *
 * `first_boot` walks the full sequence. `change` only considers the operations
 * the caller actually asked for, so a DNS request yields a one-step plan.
 */
export function buildPlan(request: PlanRequest): OperationPlan {
  const { template, snapshot, desired, mode, detected, vmid } = request
  const wanted: GuestOperation[] = []

  if (mode === "first_boot") {
    wanted.push(...FIRST_BOOT_SEQUENCE)
    if (desired.createUser) wanted.push("create_user")
  } else {
    if (desired.ip !== undefined) wanted.push("set_ip", "set_gateway")
    if (desired.dns !== undefined) wanted.push("set_dns")
    if (desired.hostname !== undefined) wanted.push("set_hostname")
    if (desired.password !== undefined) wanted.push("set_password")
    if (desired.createUser) wanted.push("create_user")
    if (desired.timezone !== undefined) wanted.push("timezone")
  }

  const operations: PlannedOperation[] = []
  const seen = new Set<GuestOperation>()

  for (const operation of wanted) {
    if (seen.has(operation)) continue
    seen.add(operation)

    const definition = definitionFor(template, operation)
    if (!definition) {
      const step = base(operation, null, "Not defined for this operating system.")
      step.status = "skipped"
      step.reason = "This operating system profile does not define this operation."
      operations.push(step)
      continue
    }
    if (!definition.enabled) {
      const step = base(operation, definition, "Disabled in the operating system profile.")
      step.status = "skipped"
      step.reason = "This operation is disabled in the operating system profile."
      operations.push(step)
      continue
    }

    const { matches, previous } = alreadyMatches(snapshot, operation, desired)
    const step = base(operation, definition, matches ? "Guest already satisfies the requested value." : "Requested change differs from current guest state.", placeholderValues(operation, desired))
    step.previous = previous
    step.stdinSecret = stdinSecretFor(operation, desired)

    if (matches && !NON_IDEMPOTENT_OPERATIONS.has(operation)) {
      step.status = "skipped"
      step.changed = false
      step.reason = "Already applied — no change needed."
    } else {
      step.changed = true
      if (matches) step.reason = "Re-applying: this operation cannot be verified idempotently."
    }

    // A secret-consuming step with no secret is not runnable.
    if (NON_IDEMPOTENT_OPERATIONS.has(operation) && !step.stdinSecret) {
      step.status = "skipped"
      step.changed = false
      step.reason = "No password supplied."
    }

    // A network step records the previous interface so a rollback knows what to
    // restore even when the guest is mid-change.
    if (operation === "set_ip" || operation === "set_gateway" || operation === "set_dns") {
      step.previous = { ...previous, interface: snapshot.primaryInterface, capturedAt: snapshot.collectedAt }
    }

    operations.push(step)
  }

  return {
    vmid,
    detected,
    template,
    operations,
    noChange: operations.every((operation) => operation.status === "skipped"),
  }
}

function placeholderValues(operation: GuestOperation, desired: PlanRequest["desired"]): Record<string, string> {
  const values: Record<string, string> = {}
  const put = (key: string, value: string | number | undefined) => {
    if (value !== undefined && value !== null && String(value) !== "") values[key] = String(value)
  }
  switch (operation) {
    case "set_ip":
    case "set_gateway":
      put("IP", desired.ip)
      put("PREFIX", desired.prefix)
      put("GATEWAY", desired.gateway)
      break
    case "set_dns":
      put("DNS1", desired.dns?.[0])
      put("DNS2", desired.dns?.[1])
      put("SEARCHDOMAIN", desired.searchDomain)
      break
    case "set_hostname":
      put("HOSTNAME", desired.hostname)
      break
    case "set_password":
      put("USERNAME", desired.username)
      break
    case "create_user":
      put("USERNAME", desired.createUser?.username)
      break
    case "timezone":
      put("TIMEZONE", desired.timezone)
      break
    default:
      break
  }
  return values
}

/**
 * The secret an operation reads from stdin. Passwords are never inlined into a
 * command: the template reads them, so the plaintext only exists in the guest's
 * stdin pipe and in this in-memory plan.
 */
function stdinSecretFor(operation: GuestOperation, desired: PlanRequest["desired"]): string | null {
  if (operation === "set_password") return desired.password ?? null
  if (operation === "create_user") return desired.createUser?.password ?? null
  return null
}

/** Public summary of a plan for the admin dry-run and audit rows. */
export function serializePlan(plan: OperationPlan) {
  return {
    vmid: plan.vmid,
    os: plan.detected.engine,
    osId: plan.detected.osId,
    version: plan.detected.version,
    template: { id: plan.template.id, name: plan.template.name, version: plan.template.version },
    noChange: plan.noChange,
    operations: plan.operations.map((operation) => ({
      operation: operation.operation,
      status: operation.status,
      reason: operation.reason,
      changed: operation.changed,
      dangerous: operation.dangerous,
      supportsRollback: operation.supportsRollback,
      rebootRequired: operation.rebootRequired,
    })),
  }
}

/** Aggregate run status from step outcomes. */
export function deriveRunStatus(steps: Array<{ status: GuestOperationStatus }>): "success" | "partial" | "failed" | "rolled_back" {
  if (!steps.length) return "success"
  const meaningful = steps.filter((step) => step.status !== "skipped")
  if (!meaningful.length) return "success"
  const failed = meaningful.filter((step) => step.status === "failed" || step.status === "timeout" || step.status === "unsupported")
  if (!failed.length) return "success"
  const succeeded = meaningful.filter((step) => step.status === "success" || step.status === "already_applied")
  return succeeded.length ? "partial" : "failed"
}

export function isNetworkOperation(operation: GuestOperation): boolean {
  return NETWORK_OPERATIONS.has(operation)
}
