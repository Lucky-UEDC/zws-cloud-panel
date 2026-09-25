export const VM_LIFECYCLE_STATES = [
  "pending",
  "provisioning",
  "active",
  "degraded",
  "overdue",
  "suspended",
  "penalty",
  "terminated",
  "failed",
  "reinstalling",
  "migrating",
] as const

export type VmLifecycleState = (typeof VM_LIFECYCLE_STATES)[number]

export const VM_AUTOMATION_STATES = [
  "paused",
  "active",
  "retrying",
  "failed",
  "manual_intervention_required",
  "suspended",
  "terminated",
] as const

export type VmAutomationState = (typeof VM_AUTOMATION_STATES)[number]

const TRANSITIONS: Record<VmLifecycleState, VmLifecycleState[]> = {
  pending: ["provisioning", "active", "failed", "terminated"],
  provisioning: ["active", "failed", "pending", "reinstalling"],
  active: ["degraded", "overdue", "suspended", "reinstalling", "migrating", "failed", "terminated"],
  degraded: ["active", "overdue", "suspended", "reinstalling", "migrating", "failed", "terminated"],
  overdue: ["active", "degraded", "suspended", "penalty", "terminated"],
  suspended: ["active", "degraded", "penalty", "terminated"],
  penalty: ["active", "terminated", "suspended"],
  terminated: [],
  failed: ["pending", "provisioning", "reinstalling", "degraded", "terminated"],
  reinstalling: ["active", "degraded", "failed"],
  migrating: ["active", "degraded", "failed"],
}

export function normalizeVmLifecycleState(value: unknown): VmLifecycleState {
  const text = String(value || "").trim().toLowerCase()
  if (["creating", "queued", "installing", "configuring", "verifying_vm", "cloning_template", "applying_cloud_init"].includes(text)) return "provisioning"
  if (["overloaded", "repair_needed"].includes(text)) return "degraded"
  if (["running", "stopped", "stop", "paused"].includes(text)) return "active"
  if (["renewal_due"].includes(text)) return "overdue"
  if (["pending_termination", "deleted"].includes(text)) return "terminated"
  if (["start_failed", "upgrade_failed"].includes(text)) return "failed"
  if (["upgrade_queued", "updating_config"].includes(text)) return "migrating"
  if (VM_LIFECYCLE_STATES.includes(text as VmLifecycleState)) return text as VmLifecycleState
  return "pending"
}

export function normalizeVmAutomationState(value: unknown): VmAutomationState {
  const text = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_")
  if (["paused", "automation_paused", "reminders_paused"].includes(text)) return "paused"
  if (["retrying", "retry", "queued", "force_retry"].includes(text)) return "retrying"
  if (["failed", "error", "start_failed", "upgrade_failed"].includes(text)) return "failed"
  if (["manual_intervention_required", "waiting_for_admin", "manual", "repair_needed"].includes(text)) return "manual_intervention_required"
  if (["suspended", "penalty"].includes(text)) return "suspended"
  if (["terminated", "deleted"].includes(text)) return "terminated"
  return "active"
}

export function canTransitionVmState(from: unknown, to: unknown) {
  const current = normalizeVmLifecycleState(from)
  const next = normalizeVmLifecycleState(to)
  return current === next || TRANSITIONS[current].includes(next)
}

export function assertVmStateTransition(from: unknown, to: unknown) {
  if (!canTransitionVmState(from, to)) {
    throw new Error(`Invalid VM lifecycle transition: ${normalizeVmLifecycleState(from)} -> ${normalizeVmLifecycleState(to)}`)
  }
}
