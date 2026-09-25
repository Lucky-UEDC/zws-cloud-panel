import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { STEP_LABELS, customerStepContentForJob, normalizeStep, sanitizeCustomerProvisioningMessage } from "@/lib/provisioning-status"
import { buildProvisioningChecklist } from "@/lib/provisioning-checklist"
import { serializeClientVmStatus } from "@/lib/vm-db-truth"
import { toJsonable } from "@/lib/json-safe"

export const dynamic = "force-dynamic"
export const revalidate = 0

function customerSteps(steps: any[] = [], jobType?: string | null) {
  const source = steps.length ? steps : [
    { id: "payment_confirmed", step: "QUEUED", status: "completed", label: "Payment confirmed" },
    { id: "selecting_location", step: "SELECTING_NODE", status: "pending", label: "Selecting deployment location" },
    { id: "preparing_os", step: "CLONING_TEMPLATE", status: "pending", label: "Preparing OS image" },
    { id: "creating_instance", step: "RESIZING_DISK", status: "pending", label: "Creating cloud instance" },
    { id: "configuring_network", step: "APPLYING_CLOUD_INIT", status: "pending", label: "Configuring network" },
    { id: "starting_server", step: "STARTING_VM", status: "pending", label: "Starting server" },
    { id: "verification", step: "VERIFYING_VM", status: "pending", label: "Final verification" },
  ]
  return source.map((step) => {
    const content = customerStepContentForJob(step.step, jobType)
    return {
      id: step.id,
      step: step.step,
      status: step.status,
      title: step.label || content.title,
      label: step.label || content.title,
      message: step.error ? sanitizeCustomerProvisioningMessage(step.error) : content.message,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      createdAt: step.createdAt,
    }
  })
}

function customerLog(log: any, jobType?: string | null) {
  if (!log) return null
  const content = customerStepContentForJob(log.step, jobType)
  return {
    id: log.id,
    createdAt: log.createdAt,
    level: log.level,
    title: content.title,
    message: sanitizeCustomerProvisioningMessage(log.message) || content.message,
  }
}

function customerJob(job: any) {
  if (!job) return null
  const reinstallSteps = (job.steps || []).filter((step: any) => String(step.step || "").startsWith("REINSTALL_"))
  const total = reinstallSteps.length || 17
  const completed = reinstallSteps.filter((step: any) => step.status === "completed").length
  const progress = job.status === "completed" ? 100 : job.type === "reinstall" ? Math.min(99, Math.round((completed / total) * 100)) : Number(job.progress || 0)
  const estimatedDurationSeconds = Number(job.metadata?.estimatedDurationSeconds || 900)
  const elapsedSeconds = job.startedAt ? Math.max(0, Math.round((Date.now() - new Date(job.startedAt).getTime()) / 1000)) : 0
  return {
    id: job.id,
    status: job.status,
    displayStatus: job.displayStatus,
    currentStep: job.currentStep,
    progress,
    estimatedDurationSeconds,
    etaSeconds: ["completed", "failed", "cancelled"].includes(String(job.status)) ? 0 : Math.max(0, estimatedDurationSeconds - elapsedSeconds),
    liveLogCursor: job.logs?.[0]?.id || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  try {
    const vmidMatch = /^\d+$/.test(id) ? { vmid: Number(id) } : undefined
    const vps = await prisma.vpsInstance.findFirst({
      where: { OR: [{ id }, { orderId: id }, ...(vmidMatch ? [vmidMatch] : [])], customerId, deletedAt: null, status: { not: "DELETED" }, order: { deletedAt: null, status: { not: "DELETED" } } },
      include: {
        order: { select: { id: true, orderNumber: true, createdAt: true, termMonths: true, status: true, provisioningStatus: true, provisioningError: true, osName: true } },
        product: { select: { id: true, name: true, cpuCores: true, ramGb: true, storageGb: true, storageType: true, bandwidthTb: true, metadata: true } },
        storagePool: true,
        operatingSystem: { select: { id: true, name: true, slug: true, osType: true, category: true, osFamily: true, osVersion: true, consoleType: true, proxmoxTemplateName: true, proxmoxConfig: true } },
        proxmoxNode: true,
        disks: { where: { status: { not: "DELETED" } }, include: { storagePool: true }, orderBy: [{ isPrimary: "desc" }, { displayName: "asc" }] },
        provisioningJobs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            steps: { orderBy: { createdAt: "asc" } },
            logs: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
      },
    })

    if (vps) {
      const payload = await serializeClientVmStatus(vps)
      return NextResponse.json(toJsonable(payload), { headers: { "Cache-Control": "no-store" } })
    }

    const pendingOrder = await prisma.order.findFirst({
      where: { id, customerId, deletedAt: null, status: { not: "DELETED" } },
      include: {
        provisioningJobs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            steps: { orderBy: { createdAt: "asc" } },
            logs: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
        product: { select: { name: true } },
        operatingSystem: { select: { name: true } },
      },
    })
    if (!pendingOrder) return NextResponse.json({ success: false, error: "Instance not found" }, { status: 404 })

    const job = pendingOrder.provisioningJobs?.[0] || null
    const step = normalizeStep(job?.currentStep || pendingOrder.provisioningStatus)
    return NextResponse.json(toJsonable({
      success: true,
      status: pendingOrder.provisioningStatus || "pending",
      displayStatus: job?.displayStatus || STEP_LABELS[step],
      provisioningStatus: pendingOrder.provisioningStatus,
      provisioningError: pendingOrder.provisioningError,
      job: customerJob(job),
      os: pendingOrder.operatingSystem?.name || pendingOrder.osName,
      currentStep: job?.currentStep || pendingOrder.provisioningStatus,
      latestLog: customerLog(job?.logs?.[0], job?.type),
      steps: customerSteps(job?.steps || [], job?.type),
      provisioningChecklist: buildProvisioningChecklist({ order: pendingOrder, vm: null, job }),
      hostname: job?.hostname || null,
      ipAddress: null,
      plan: pendingOrder.product?.name || "Instance",
      billingStatus: pendingOrder.status,
      createdAt: pendingOrder.createdAt,
      cpu: 0,
      cpuPercent: 0,
      memory: 0,
      ramUsedBytes: 0,
      ramTotalBytes: 0,
      ramPercent: 0,
      diskUsedBytes: 0,
      diskTotalBytes: 0,
      diskPercent: 0,
      diskUsage: { usedGb: null, freeGb: null, totalGb: null, percent: null, reported: false, source: "unavailable" },
      monitoringStatus: "Provisioning",
      guestAgentStatus: "unavailable",
      uptime: 0,
      netin: 0,
      netout: 0,
    }), { headers: { "Cache-Control": "no-store" } })
  } catch (error: any) {
    const message = String(error?.message || error || "unknown")
    const databaseUnavailable = /(database_unavailable|ECONNREFUSED|ETIMEDOUT|P1001|P1002|query engine|Can't reach database)/i.test(message)
    console.error("[CLIENT_VPS_STATUS]", { customerId, id, errorCode: databaseUnavailable ? "DB_UNAVAILABLE" : "LOAD_FAILED", message })
    return NextResponse.json(
      {
        success: false,
        error: databaseUnavailable
          ? "Unable to load server state right now. Please retry in a moment."
          : "Unable to load server state. Please retry.",
        errorCode: databaseUnavailable ? "DB_UNAVAILABLE" : "LOAD_FAILED",
      },
      { status: databaseUnavailable ? 503 : 500 },
    )
  }
}
