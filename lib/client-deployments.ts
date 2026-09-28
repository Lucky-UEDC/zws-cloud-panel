import { prisma } from "@/lib/db"
import {
  STEP_LABELS,
  customerStepContentForJob,
  sanitizeCustomerProvisioningMessage,
  sanitizeProvisioningError,
  type ProvisioningStep,
} from "@/lib/provisioning-status"
import { createProxmoxClient } from "@/lib/proxmox"
import { markRuntimeCompleteIfReady, probeVmRuntimeHealth } from "@/lib/vm-runtime-health"

/**
 * The deployment stages a customer sees.
 *
 * These are the real pipeline, in order, with the guest-automation steps spelled
 * out rather than collapsed into one "configuring" row. A customer watching a
 * server take four minutes to become usable deserves to know that the wait is
 * their operating system booting, not a spinner with no explanation.
 *
 * `SERVICE_ACTIVE` and `SERVICE_FAILED` are terminal. The customer page only
 * auto-redirects on `SERVICE_ACTIVE`, because a redirect to a server that is not
 * ready is a worse experience than watching the last step.
 *
 * The `matches` lists are the internal step tokens, including legacy ones. A
 * token that is absent simply leaves that stage pending rather than erroring.
 */
const DEPLOYMENT_STAGES = [
  { key: "PAYMENT_PENDING", title: "Payment pending", matches: ["payment_pending", "pending_payment", "payment_processing"] },
  { key: "PAYMENT_CONFIRMED", title: "Payment confirmed", matches: ["paid", "payment_success", "payment_confirmed", "QUEUED"] },
  { key: "ORDER_ACCEPTED", title: "Order accepted", matches: ["order_accepted", "queued", "QUEUED"] },
  { key: "NODE_SELECTED", title: "Choosing a location", matches: ["SELECTING_NODE", "WAITING_FOR_CAPACITY", "WAITING_FOR_ADMIN"] },
  { key: "VM_CREATED", title: "Server created", matches: ["CLONING_TEMPLATE", "CLONE_COMPLETE"] },
  { key: "VM_STARTED", title: "Server starting", matches: ["CONFIGURING_VM", "RESIZING_DISK", "ASSIGNING_IP", "STARTING_VM"] },
  { key: "WAITING_GUEST_AGENT", title: "Waiting for your server to respond", matches: ["WAITING_GUEST_AGENT"] },
  { key: "DETECTING_OS", title: "Checking the operating system", matches: ["DETECTING_OS"] },
  { key: "LOADING_OS_TEMPLATE", title: "Preparing the right configuration", matches: ["APPLYING_CLOUD_INIT"] },
  { key: "CONFIGURING_NETWORK", title: "Setting up the network", matches: ["CONFIGURING_NETWORK"] },
  { key: "CONFIGURING_ACCESS", title: "Setting up access", matches: ["CONFIGURING_ACCESS"] },
  { key: "CONFIGURING_GUEST", title: "Applying system settings", matches: ["CONFIGURING_GUEST"] },
  { key: "VERIFYING_GUEST", title: "Confirming everything worked", matches: ["VERIFYING_GUEST", "VERIFYING_VM"] },
  { key: "COLLECTING_METRICS", title: "Collecting resource usage", matches: ["COLLECTING_METRICS"] },
  { key: "SERVICE_ACTIVE", title: "Ready", matches: ["ACTIVE", "SERVICE_ACTIVE"] },
]

const INTERNAL_PROVISIONING_TEXT =
  /(?:upid|proxmox|qmclone|qmstart|\bqemu\b|\blxc\b|vmid|root@pam|api2\/json|pveapitoken|vncproxy|vncwebsocket|\/nodes\/|worker|scheduler|janitor|storage pool|cloning_template|clone_complete|applying_cloud_init|configuring_vm|resizing_disk|assigning_ip|starting_vm|verifying_vm|selecting_node|waiting_for_capacity|waiting_for_admin|upgrade_queued|updating_config|\bcloning\b|\btemplate (?:clone|os)\b|\btask (?:running|queued|started|stopped)\b)/i

function looksInternalProvisioningText(value: string) {
  return Boolean(value) && INTERNAL_PROVISIONING_TEXT.test(String(value))
}

function serializeLog(log: any, jobType?: string | null) {
  const content = customerStepContentForJob(log?.step, jobType)
  const rawMessage = String(log?.message || "").trim()
  const sanitized = sanitizeCustomerProvisioningMessage(rawMessage)
  // Hard client boundary: if the sanitizer let a raw technical string through
  // unchanged, fall back to the friendly per-step copy instead of echoing it.
  const message = sanitized && !(rawMessage && looksInternalProvisioningText(rawMessage) && sanitized === rawMessage)
    ? sanitized
    : content.message
  return {
    id: log.id,
    createdAt: log.createdAt,
    level: log.level,
    title: content.title,
    message,
  }
}

function serializeSteps(steps: any[] = [], jobType?: string | null) {
  return steps.map((step) => {
    const content = customerStepContentForJob(step.step, jobType)
    return {
      id: step.id,
      title: step.label || content.title,
      status: step.status,
      message: step.error ? sanitizeCustomerProvisioningMessage(step.error) : content.message,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      createdAt: step.createdAt,
    }
  })
}

function clientSafeRuntimeHealth(health: any) {
  if (!health) return null
  // Never expose Proxmox runtime diagnostics (vmid, nodeName, urls, errors) to
  // the customer; only the readiness flags are client-safe.
  return {
    completionEligible: Boolean(health.completionEligible),
    pingOk: Boolean(health.pingOk),
    sshOk: Boolean(health.sshOk),
    guestConfiguredOk: Boolean(health.guestConfiguredOk),
    checkedAt: health.checkedAt || null,
  }
}

function stageStatus(stage: (typeof DEPLOYMENT_STAGES)[number], index: number, activeIndex: number, failed: boolean, complete: boolean) {
  if (failed && index === activeIndex) return "failed"
  if (index < activeIndex || (index === activeIndex && complete)) return "completed"
  if (index === activeIndex) return "running"
  return "pending"
}

/** The only state in which a customer's server is usable. */
const SERVICE_ACTIVE_TOKENS = new Set(["ACTIVE", "SERVICE_ACTIVE", "COMPLETED", "RUNNING"])

/** States where the pipeline stopped and will not proceed on its own. */
const FAILED_TOKENS = new Set(["FAILED", "START_FAILED", "SERVICE_FAILED", "REPAIR_NEEDED", "UPGRADE_FAILED", "CANCELLED", "CANCELED"])

function activeStageIndex(current: string) {
  const normalized = current.toLowerCase()
  for (let index = DEPLOYMENT_STAGES.length - 1; index >= 0; index -= 1) {
    if (DEPLOYMENT_STAGES[index].matches.some((match) => match.toLowerCase() === normalized)) return index
  }
  return -1
}

function estimatedRemaining(activeIndex: number, complete: boolean, metadata: Record<string, any>) {
  if (complete) return null
  if (metadata.estimatedCompletion) return metadata.estimatedCompletion
  const remainingStages = Math.max(1, DEPLOYMENT_STAGES.length - Math.max(0, activeIndex) - 1)
  const minutes = Math.max(1, Math.min(12, remainingStages * 2))
  return `${minutes}-${minutes + 2} minutes`
}

export async function getClientDeploymentSnapshot(input: { id: string; customerId: string }) {
  const order = await prisma.order.findFirst({
    where: { OR: [{ id: input.id }, { serviceId: input.id }], customerId: input.customerId, deletedAt: null },
    include: {
      product: true,
      operatingSystem: true,
      vpsInstance: { include: { proxmoxNode: true } },
      provisioningJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          steps: { orderBy: { createdAt: "asc" } },
          logs: { orderBy: { createdAt: "desc" }, take: 100 },
        },
      },
    },
  })
  if (!order) return null

  const job = order.provisioningJobs[0] || null
  let current = String(job?.currentStep || order.provisioningStatus || order.status || "pending")
  const jobFailed = ["failed", "FAILED", "START_FAILED", "UPGRADE_FAILED"].includes(current) || ["failed"].includes(String(job?.status || ""))
  let runtimeHealth = null as Awaited<ReturnType<typeof probeVmRuntimeHealth>> | null
  if (order.vpsInstance?.proxmoxNode && order.vpsInstance.vmid) {
    const node = order.vpsInstance.proxmoxNode
    const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, { allowInsecureTls: node.allowInsecureTls })
    runtimeHealth = await probeVmRuntimeHealth({
      client,
      nodeName: node.nodeName,
      vmid: order.vpsInstance.vmid,
      allocatedIp: order.vpsInstance.ipAddress,
      hostname: order.vpsInstance.name,
      dbStatus: order.vpsInstance.status,
    }).catch(() => null)
    if (runtimeHealth?.completionEligible && String(order.provisioningStatus || "").toUpperCase() !== "ACTIVE") {
      await markRuntimeCompleteIfReady({ vpsId: order.vpsInstance.id, health: runtimeHealth, actor: "client_deployment_snapshot" }).catch(() => null)
      current = "ACTIVE"
      order.provisioningStatus = "ACTIVE" as any
      if (job) {
        job.status = "completed"
        job.currentStep = "ACTIVE"
        job.progress = 100
        job.displayStatus = "Your cloud server is ready"
      }
    }
  }
  const activeIndex = Math.max(0, activeStageIndex(current))
  // `SERVICE_ACTIVE` is the only state that means "usable". A runtime probe that
  // says the guest answers is supporting evidence, not the definition: the
  // definition is that the pipeline reached its terminal stage.
  const reachedActiveStage = SERVICE_ACTIVE_TOKENS.has(String(current).toUpperCase())
  const failed = FAILED_TOKENS.has(String(current).toUpperCase())
  const complete = reachedActiveStage || String(current).toUpperCase() === "ACTIVE" || Boolean(runtimeHealth?.completionEligible)
  const failedState = failed || jobFailed
  const progress = complete ? 100 : job?.progress ?? (order.vpsInstance ? 100 : Math.round(((activeIndex + 1) / DEPLOYMENT_STAGES.length) * 100))
  const metadata = job?.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata) ? job.metadata as Record<string, any> : {}

  const automationRaw = String(job?.status || order.provisioningStatus || order.status || "pending")
  const automationStepKey = automationRaw.toUpperCase()
  // Translate raw internal step tokens (CLONING_TEMPLATE, START_FAILED, ...) to
  // customer-facing labels for the status badge; keep neutral status words.
  const automationState = automationStepKey in STEP_LABELS
    ? String(STEP_LABELS[automationStepKey as ProvisioningStep])
    : automationRaw

  const friendlyFailureReason = (value: unknown) => {
    try {
      const friendly = sanitizeProvisioningError(value)
      return looksInternalProvisioningText(friendly) ? "Deployment requires attention. Our team has been notified." : friendly
    } catch {
      return "Deployment requires attention. Our team has been notified."
    }
  }
  const defaultFix = "Provisioning will retry automatically. Open deployment logs if it remains stuck."

  return {
    success: true,
    id: order.id,
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.provisioningStatus || order.status,
    serviceStatus: order.vpsInstance?.status || null,
    automationState,
    currentStage: current,
    displayStatus: complete ? "Your cloud server is ready" : job?.displayStatus || (order.vpsInstance ? "Your cloud server is ready" : "Provisioning"),
    progress: Math.max(0, Math.min(100, Number(progress || 0))),
    runtimeHealth: clientSafeRuntimeHealth(runtimeHealth),
    retryState: {
      attempts: job?.attempts || 0,
      maxAttempts: job?.maxAttempts || 3,
      nextRetryAt: job?.nextRetryAt || null,
      retryCountdownSeconds: job?.nextRetryAt ? Math.max(0, Math.ceil((new Date(job.nextRetryAt).getTime() - Date.now()) / 1000)) : null,
    },
    failure: failedState ? {
      reason: friendlyFailureReason(order.provisioningError || job?.error || "Deployment requires attention."),
      code: null,
      suggestedFix: (() => {
        const fix = String(metadata.suggestedFix || defaultFix)
        return looksInternalProvisioningText(fix) ? defaultFix : sanitizeCustomerProvisioningMessage(fix) || defaultFix
      })(),
    } : null,
    vm: {
      id: order.vpsInstance?.id || null,
      instanceId: order.vpsInstance?.id || null,
      hostname: order.vpsInstance?.name || order.hostname || job?.hostname || null,
      ipAddress: order.vpsInstance?.ipAddress || null,
      status: order.vpsInstance?.status || null,
      os: order.operatingSystem?.name || order.osName || null,
      plan: order.product?.name || "Cloud Instance",
    },
    network: {
      status: order.vpsInstance?.ipAddress ? "attached" : "pending",
      ipAssigned: Boolean(order.vpsInstance?.ipAddress),
      infrastructureZone: order.vpsInstance?.proxmoxNode?.location || "Default zone",
    },
    stages: DEPLOYMENT_STAGES.map((stage, index) => ({
      key: stage.key,
      title: stage.title,
      status: stageStatus(stage, index, activeIndex === -1 ? 0 : activeIndex, failedState, complete),
    })),
    // The terminal stage, named explicitly, so the client page can decide to
    // redirect on SERVICE_ACTIVE and on nothing else.
    terminal: complete ? "SERVICE_ACTIVE" : failedState ? "SERVICE_FAILED" : null,
    steps: serializeSteps(job?.steps || [], job?.type),
    logs: (job?.logs || []).map((log) => serializeLog(log, job?.type)),
    createdAt: order.createdAt,
    updatedAt: job?.updatedAt || order.updatedAt,
    estimatedCompletion: estimatedRemaining(activeIndex, complete, metadata),
  }
}
