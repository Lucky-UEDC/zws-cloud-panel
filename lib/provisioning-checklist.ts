export type ProvisioningChecklistItem = {
  key: string
  label: string
  status: "pending" | "running" | "completed" | "failed"
  completedAt?: string | null
}

const CHECKLIST = [
  ["order_created", "Order Created"],
  ["payment_verified", "Payment Verified"],
  ["resources_reserved", "Resources Reserved"],
  ["node_selected", "Node Selected"],
  ["vm_created", "VM Created"],
  ["os_installed", "OS Installed"],
  ["ip_assigned", "IP Assigned"],
  ["credentials_generated", "Credentials Generated"],
  ["email_sent", "Email Sent"],
  ["service_activated", "Service Activated"],
] as const

function iso(value: unknown): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function paid(input: { order?: any; invoice?: any; payment?: any }) {
  const statuses = new Set(["paid", "active", "completed", "success"])
  return statuses.has(String(input.order?.status || "").toLowerCase()) ||
    statuses.has(String(input.invoice?.status || "").toLowerCase()) ||
    statuses.has(String(input.payment?.status || "").toLowerCase())
}

function stepStatus(steps: any[], names: string[]) {
  const matched = steps.filter((step) => names.includes(String(step?.step || "").toUpperCase()))
  if (matched.some((step) => String(step.status || "").toLowerCase() === "failed")) return { status: "failed" as const, completedAt: null }
  if (matched.some((step) => String(step.status || "").toLowerCase() === "running")) return { status: "running" as const, completedAt: null }
  const completed = matched.find((step) => String(step.status || "").toLowerCase() === "completed" || step.completedAt)
  return completed ? { status: "completed" as const, completedAt: iso(completed.completedAt) } : { status: "pending" as const, completedAt: null }
}

export function buildProvisioningChecklist(input: {
  order?: any
  invoice?: any
  payment?: any
  vm?: any
  job?: any
}): ProvisioningChecklistItem[] {
  const steps = Array.isArray(input.job?.steps) ? input.job.steps : []
  const active = String(input.order?.provisioningStatus || input.vm?.status || "").toUpperCase() === "ACTIVE"
  const hasVm = Boolean(input.vm?.id || input.order?.vmId)
  const hasIp = Boolean(input.vm?.ipAddress || input.order?.primaryIp || input.order?.ipAddress)
  const hasCredentials = Boolean(input.vm?.username || input.order?.adminUsername || input.order?.passwordEncrypted || input.vm?.passwordEncrypted)
  const paymentDone = paid(input)
  const emailSent = Boolean(input.job?.completedAt || active || (input.order?.metadata && typeof input.order.metadata === "object" && (input.order.metadata as any).serviceEmailSentAt))

  const statusByKey: Record<string, { status: ProvisioningChecklistItem["status"]; completedAt?: string | null }> = {
    order_created: { status: input.order?.id ? "completed" : "pending", completedAt: iso(input.order?.createdAt) },
    payment_verified: { status: paymentDone ? "completed" : "pending", completedAt: iso(input.invoice?.paidAt || input.payment?.completedAt || input.payment?.webhookProcessedAt) },
    resources_reserved: hasVm ? { status: "completed", completedAt: iso(input.vm?.createdAt) } : stepStatus(steps, ["SELECTING_NODE", "WAITING_FOR_CAPACITY"]),
    node_selected: input.order?.proxmoxNodeId || input.job?.proxmoxNodeId || input.vm?.proxmoxNodeId ? { status: "completed", completedAt: iso(input.job?.startedAt) } : stepStatus(steps, ["SELECTING_NODE"]),
    vm_created: hasVm ? { status: "completed", completedAt: iso(input.vm?.createdAt) } : stepStatus(steps, ["CLONING_TEMPLATE", "CLONE_COMPLETE"]),
    os_installed: active || hasVm ? { status: "completed", completedAt: iso(input.job?.completedAt || input.vm?.createdAt) } : stepStatus(steps, ["CLONING_TEMPLATE", "CLONE_COMPLETE", "APPLYING_CLOUD_INIT"]),
    ip_assigned: hasIp ? { status: "completed", completedAt: iso(input.vm?.updatedAt || input.job?.completedAt) } : stepStatus(steps, ["ASSIGNING_IP"]),
    credentials_generated: hasCredentials ? { status: "completed", completedAt: iso(input.vm?.createdAt || input.order?.createdAt) } : { status: "pending" },
    email_sent: emailSent ? { status: "completed", completedAt: iso(input.job?.completedAt || input.order?.provisionedAt) } : { status: paymentDone ? "running" : "pending" },
    service_activated: active ? { status: "completed", completedAt: iso(input.order?.provisionedAt || input.vm?.activatedAt || input.job?.completedAt) } : stepStatus(steps, ["ACTIVE"]),
  }

  if (String(input.job?.status || "").toLowerCase() === "failed") {
    const current = String(input.job?.currentStep || "").toUpperCase()
    for (const [key] of CHECKLIST) {
      const item = statusByKey[key]
      if (item.status === "running" || item.status === "pending" && current) {
        statusByKey[key] = { status: "failed", completedAt: null }
        break
      }
    }
  }

  return CHECKLIST.map(([key, label]) => ({ key, label, status: statusByKey[key]?.status || "pending", completedAt: statusByKey[key]?.completedAt || null }))
}

