import { prisma } from "@/lib/db"
import { customerStepContentForJob, sanitizeCustomerProvisioningMessage } from "@/lib/provisioning-status"
import { createProxmoxClient } from "@/lib/proxmox"
import { markRuntimeCompleteIfReady, probeVmRuntimeHealth } from "@/lib/vm-runtime-health"

const DEPLOYMENT_STAGES = [
  { key: "PAYMENT_PENDING", title: "Payment pending", matches: ["payment_pending", "pending_payment", "payment_processing"] },
  { key: "PAYMENT_CONFIRMED", title: "Payment confirmed", matches: ["paid", "payment_success", "payment_confirmed"] },
  { key: "ORDER_ACCEPTED", title: "Order accepted", matches: ["order_accepted", "queued", "QUEUED"] },
  { key: "SELECTING_LOCATION", title: "Selecting deployment location", matches: ["SELECTING_NODE", "WAITING_FOR_CAPACITY", "WAITING_FOR_ADMIN"] },
  { key: "CLONING_TEMPLATE", title: "Installing operating system", matches: ["CLONING_TEMPLATE", "CLONE_COMPLETE"] },
  { key: "CONFIGURING_VM", title: "Configuring server", matches: ["CONFIGURING_VM", "RESIZING_DISK"] },
  { key: "INSTALLING_OS", title: "Applying cloud-init", matches: ["APPLYING_CLOUD_INIT"] },
  { key: "CONFIGURING_NETWORK", title: "Configuring network", matches: ["ASSIGNING_IP", "ip_reserved"] },
  { key: "STARTING_VM", title: "Starting server", matches: ["STARTING_VM"] },
  { key: "DETECTING_IP", title: "Detecting IP address", matches: ["VERIFYING_VM", "starting", "configuring"] },
  { key: "CONFIGURING_GUEST", title: "Configuring guest", matches: ["STOPPED"] },
  { key: "VERIFYING_SERVICE", title: "Final verification", matches: ["delivered"] },
  { key: "SERVICE_ACTIVE", title: "Service active", matches: ["ACTIVE"] },
]

function serializeLog(log: any, jobType?: string | null) {
  const content = customerStepContentForJob(log?.step, jobType)
  return {
    id: log.id,
    createdAt: log.createdAt,
    level: log.level,
    title: content.title,
    message: sanitizeCustomerProvisioningMessage(log.message) || content.message,
  }
}

function serializeSteps(steps: any[] = [], jobType?: string | null) {
  return steps.map((step) => {
    const content = customerStepContentForJob(step.step, jobType)
    return {
      id: step.id,
      step: step.step,
      title: step.label || content.title,
      status: step.status,
      message: step.error ? sanitizeCustomerProvisioningMessage(step.error) : content.message,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      createdAt: step.createdAt,
    }
  })
}

function stageStatus(stage: (typeof DEPLOYMENT_STAGES)[number], index: number, activeIndex: number, failed: boolean) {
  if (failed && index === activeIndex) return "failed"
  if (index < activeIndex) return "completed"
  if (index === activeIndex) return stage.key === "SERVICE_READY" ? "completed" : "running"
  return "pending"
}

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
  const failed = ["failed", "FAILED", "START_FAILED", "UPGRADE_FAILED"].includes(current) || ["failed"].includes(String(job?.status || ""))
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
  const complete = String(current).toUpperCase() === "ACTIVE" || Boolean(runtimeHealth?.completionEligible)
  const progress = complete ? 100 : job?.progress ?? (order.vpsInstance ? 100 : Math.round(((activeIndex + 1) / DEPLOYMENT_STAGES.length) * 100))
  const metadata = job?.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata) ? job.metadata as Record<string, any> : {}

  return {
    success: true,
    id: order.id,
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.provisioningStatus || order.status,
    serviceStatus: order.vpsInstance?.status || null,
    automationState: job?.status || order.provisioningStatus || "pending",
    currentStage: current,
    displayStatus: complete ? "Your cloud server is ready" : job?.displayStatus || (order.vpsInstance ? "Your cloud server is ready" : "Provisioning"),
    progress: Math.max(0, Math.min(100, Number(progress || 0))),
    runtimeHealth,
    retryState: {
      attempts: job?.attempts || 0,
      maxAttempts: job?.maxAttempts || 3,
      nextRetryAt: job?.nextRetryAt || null,
      retryCountdownSeconds: job?.nextRetryAt ? Math.max(0, Math.ceil((new Date(job.nextRetryAt).getTime() - Date.now()) / 1000)) : null,
    },
    failure: failed ? {
      reason: order.provisioningError || job?.error || "Deployment requires attention.",
      code: job?.errorCode || null,
      suggestedFix: metadata.suggestedFix || "The provisioning worker will retry automatically. Open deployment logs if it remains stuck.",
    } : null,
    vm: {
      id: order.vpsInstance?.id || null,
      instanceId: order.vpsInstance?.id || order.id,
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
      status: stageStatus(stage, index, activeIndex === -1 ? 0 : activeIndex, failed),
    })),
    steps: serializeSteps(job?.steps || [], job?.type),
    logs: (job?.logs || []).map((log) => serializeLog(log, job?.type)),
    createdAt: order.createdAt,
    updatedAt: job?.updatedAt || order.updatedAt,
    estimatedCompletion: estimatedRemaining(activeIndex, complete, metadata),
  }
}
