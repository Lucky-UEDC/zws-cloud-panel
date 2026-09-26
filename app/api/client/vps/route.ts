import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getClientFromCookies } from "@/lib/server-auth"
import { customerStepContentForJob, sanitizeCustomerProvisioningMessage } from "@/lib/provisioning-status"
import { customerFacingVpsStatus } from "@/lib/vps-lifecycle"
import { lifecycleDates } from "@/lib/renewals"
import { normalizeVmAutomationState, normalizeVmLifecycleState } from "@/lib/vm-state-machine"
import { formatBandwidthQuota } from "@/lib/bandwidth-format"
import { hostnameFromIp, friendlyVmDisplayName } from "@/lib/vm-hostname"

export const dynamic = "force-dynamic"
export const revalidate = 0

function cleanProgress(job: any) {
  if (!job) return null
  const content = customerStepContentForJob(job.currentStep, job.type)
  return {
    id: job.id,
    status: job.status,
    displayStatus: content.title,
    currentStep: job.currentStep,
  }
}

function cleanLog(log: any) {
  if (!log) return null
  const content = customerStepContentForJob(log.step, log.jobType)
  return {
    id: log.id,
    createdAt: log.createdAt,
    level: log.level,
    title: content.title,
    message: sanitizeCustomerProvisioningMessage(log.message) || content.message,
  }
}

export async function GET() {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

  const [vpsRows, pendingOrders] = await Promise.all([
    prisma.vpsInstance.findMany({
      where: { customerId, deletedAt: null, status: { not: "DELETED" }, order: { deletedAt: null, status: { not: "DELETED" } } },
      include: {
        product: { select: { id: true, name: true, cpuCores: true, ramGb: true, storageGb: true, bandwidthTb: true, metadata: true } },
        operatingSystem: { select: { id: true, name: true } },
        proxmoxNode: { select: { id: true, nodeName: true, status: true } },
        order: { select: { id: true, orderNumber: true, createdAt: true, termMonths: true, status: true, osName: true, provisioningStatus: true, provisioningError: true } },
        provisioningJobs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            steps: { orderBy: { createdAt: "asc" } },
            logs: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.order.findMany({
      where: { customerId, deletedAt: null, vpsInstance: null, status: { in: ["pending", "paid", "payment_verified", "active"] } },
      include: {
        product: { select: { id: true, name: true, cpuCores: true, ramGb: true, storageGb: true, bandwidthTb: true } },
        operatingSystem: { select: { id: true, name: true } },
        provisioningJobs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            steps: { orderBy: { createdAt: "asc" } },
            logs: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ])

  const instances = vpsRows.map((vps) => {
    const lifecycle = lifecycleDates({
      createdAt: vps.createdAt,
      termMonths: vps.order.termMonths,
      renewalDueAt: vps.renewalDueAt || vps.nextRenewalAt,
      graceDays: vps.graceDays,
      penaltyWindowDays: vps.penaltyWindowDays,
      terminationWindowDays: vps.terminationWindowDays,
      retentionDays: vps.retentionDays,
    })
    const lifecycleSuspendAt = vps.suspendAt && lifecycle.deletionAt && vps.suspendAt.getTime() <= lifecycle.deletionAt.getTime() ? vps.suspendAt : lifecycle.suspendAt
    const lifecyclePenaltyAt = vps.penaltyAt && lifecycle.deletionAt && vps.penaltyAt.getTime() <= lifecycle.deletionAt.getTime() ? vps.penaltyAt : lifecycle.penaltyAt
    const lifecycleTerminationAt = vps.terminationAt && lifecycle.deletionAt && vps.terminationAt.getTime() <= lifecycle.deletionAt.getTime() ? vps.terminationAt : lifecycle.terminationAt
    const lifecycleDeletionAt = vps.deletionAt || lifecycle.deletionAt
    const serviceState = String(vps.status || "").toUpperCase()
    const consoleAvailable = Boolean(
      vps.id &&
      vps.consoleEnabled !== false &&
      vps.vmid &&
      vps.proxmoxNodeId &&
      vps.proxmoxNode?.nodeName &&
      !["DELETED", "TERMINATED", "CANCELLED", "EXPIRED"].includes(serviceState)
    )
    const automationState = normalizeVmAutomationState(
      vps.automationPausedAt || vps.remindersPausedAt
        ? "paused"
        : vps.suspendedAt
          ? "suspended"
          : vps.provisioningJobs[0]?.status || vps.order.provisioningStatus || vps.status
    )
    return ({
    id: vps.id,
    orderId: vps.orderId,
    orderNumber: vps.order.orderNumber,
    hostname: hostnameFromIp(vps.ipAddress) || (typeof vps.hostname === "string" && vps.hostname.startsWith("ip-") ? vps.hostname : null),
    displayTag: typeof vps.displayTag === "string" ? vps.displayTag : null,
    name: friendlyVmDisplayName({ displayTag: vps.displayTag, ipAddress: vps.ipAddress, hostname: vps.hostname }) || null,
    ipAddress: vps.ipAddress,
    os: vps.operatingSystem?.name || vps.order.osName,
    plan: vps.product?.name || "Instance",
    customerEmail: customer?.email || null,
    resources: {
      cpuCores: vps.cpuCores || vps.product?.cpuCores || null,
      ramGb: vps.ramGb || vps.product?.ramGb || null,
      diskGb: vps.diskGb || vps.product?.storageGb || null,
      bandwidthTb: (vps as any).bandwidthTb ? Number((vps as any).bandwidthTb || 0) : vps.product ? Number(vps.product.bandwidthTb || 0) : null,
      bandwidthLabel: (vps as any).bandwidthTb ? formatBandwidthQuota((vps as any).bandwidthTb) : vps.product ? formatBandwidthQuota(vps.product.bandwidthTb) : null,
    },
    status: vps.status,
    customerStatus: customerFacingVpsStatus(vps.status, vps.order.provisioningStatus),
    consoleEnabled: vps.consoleEnabled,
    consoleAvailable,
    provisioningStatus: vps.order.provisioningStatus,
    provisioningError: vps.order.provisioningError,
    billingStatus: vps.order.status,
    progress: cleanProgress(vps.provisioningJobs[0]),
    currentStep: vps.provisioningJobs[0]?.currentStep || vps.order.provisioningStatus,
    latestLog: cleanLog(vps.provisioningJobs[0]?.logs?.[0] ? { ...vps.provisioningJobs[0]?.logs?.[0], jobType: vps.provisioningJobs[0]?.type } : null),
    nextRenewalAt: lifecycle.renewalDueAt,
    renewalDueAt: lifecycle.renewalDueAt,
    suspendAt: lifecycleSuspendAt,
    penaltyAt: lifecyclePenaltyAt,
    terminationAt: lifecycleTerminationAt,
    deletionAt: lifecycleDeletionAt,
    penaltyAppliedAt: vps.penaltyAppliedAt,
    lastReminderLevel: vps.lastReminderLevel,
    lastReminderSentAt: vps.lastReminderSentAt,
    autoSuspendEnabled: vps.autoSuspendEnabled,
    autoDeleteEnabled: vps.autoDeleteEnabled,
    automationPausedAt: vps.automationPausedAt,
    remindersPausedAt: vps.remindersPausedAt,
    renewalAmount: vps.renewalAmount ? Number(vps.renewalAmount) : null,
    lifecycle: {
      orderCreatedAt: lifecycle.orderCreatedAt,
      nextBillingDate: lifecycle.renewalDueAt,
      renewalDueAt: lifecycle.renewalDueAt,
      gracePeriodEnds: lifecycle.gracePeriodEnds,
      serviceSuspensionDate: lifecycleSuspendAt,
      suspendAt: lifecycleSuspendAt,
      penaltyActivation: lifecyclePenaltyAt,
      penaltyAt: lifecyclePenaltyAt,
      terminationAt: lifecycleTerminationAt,
      permanentDeletionDate: lifecycleDeletionAt,
      deletionAt: lifecycleDeletionAt,
      dataRetentionWindow: `${vps.retentionDays || lifecycle.dataRetentionWindowDays} days`,
      billingCycle: vps.billingCycle || "monthly",
      autoRenewal: vps.autoSuspendEnabled && vps.autoDeleteEnabled ? "Automation active" : "Manual review",
      outstandingBalance: 0,
      serviceStatus: vps.status,
    },
    automationState,
    stateMachine: {
      lifecycleState: normalizeVmLifecycleState(vps.status),
      automationState,
      rawStatus: vps.status,
      provisioningStatus: vps.order.provisioningStatus,
    },
    metricsSource: { runtime: "unavailable", cpu: "unavailable", memory: "unavailable", disk: "unavailable", network: "unavailable" },
    storageEnterprise: { source: "unavailable", health: "Unavailable", replicationStatus: "Unavailable" },
    networkIntelligence: null,
    diagnostics: { liveStatusAvailable: false },
    activity: {
      latestLog: cleanLog(vps.provisioningJobs[0]?.logs?.[0] ? { ...vps.provisioningJobs[0]?.logs?.[0], jobType: vps.provisioningJobs[0]?.type } : null),
      currentStep: vps.provisioningJobs[0]?.currentStep || vps.order.provisioningStatus,
    },
    createdAt: vps.createdAt,
  })})

  const pending = pendingOrders
    .filter((order) => String((order.metadata as any)?.kind || "") !== "upgrade")
    .map((order) => ({
      id: order.id,
      orderId: order.id,
      orderNumber: order.orderNumber,
      hostname: order.hostname || null,
      ipAddress: null,
      os: order.operatingSystem?.name || order.osName,
      plan: order.product?.name || "Instance",
      customerEmail: customer?.email || null,
      resources: {
        cpuCores: order.product?.cpuCores || null,
        ramGb: order.product?.ramGb || null,
        diskGb: order.product?.storageGb || null,
        bandwidthTb: order.product ? Number(order.product.bandwidthTb || 0) : null,
        bandwidthLabel: order.product ? formatBandwidthQuota(order.product.bandwidthTb) : null,
      },
      status: "CREATING",
      customerStatus: customerFacingVpsStatus("CREATING", order.provisioningStatus),
      provisioningStatus: order.provisioningStatus,
      provisioningError: order.provisioningError,
      billingStatus: order.status,
      progress: cleanProgress(order.provisioningJobs[0]),
      currentStep: order.provisioningJobs[0]?.currentStep || order.provisioningStatus,
      latestLog: cleanLog(order.provisioningJobs[0]?.logs?.[0] ? { ...order.provisioningJobs[0]?.logs?.[0], jobType: order.provisioningJobs[0]?.type } : null),
      lifecycle: {
        orderCreatedAt: order.createdAt,
        nextBillingDate: null,
        renewalDueAt: null,
        gracePeriodEnds: null,
        serviceSuspensionDate: null,
        penaltyActivation: null,
        permanentDeletionDate: null,
        dataRetentionWindow: null,
        billingCycle: null,
        autoRenewal: "Pending provisioning",
        outstandingBalance: 0,
        serviceStatus: "CREATING",
      },
      automationState: normalizeVmAutomationState(order.provisioningJobs[0]?.status || order.provisioningStatus || "retrying"),
      stateMachine: {
        lifecycleState: normalizeVmLifecycleState(order.provisioningStatus || "CREATING"),
        automationState: normalizeVmAutomationState(order.provisioningJobs[0]?.status || order.provisioningStatus || "retrying"),
        rawStatus: "CREATING",
        provisioningStatus: order.provisioningStatus,
      },
      metricsSource: { runtime: "unavailable", cpu: "unavailable", memory: "unavailable", disk: "unavailable", network: "unavailable" },
      storageEnterprise: { source: "unavailable", health: "Unavailable", replicationStatus: "Unavailable" },
      networkIntelligence: null,
      diagnostics: { liveStatusAvailable: false },
      activity: {
        latestLog: cleanLog(order.provisioningJobs[0]?.logs?.[0] ? { ...order.provisioningJobs[0]?.logs?.[0], jobType: order.provisioningJobs[0]?.type } : null),
        currentStep: order.provisioningJobs[0]?.currentStep || order.provisioningStatus,
      },
      createdAt: order.createdAt,
    }))

  return NextResponse.json({ success: true, items: [...instances, ...pending], instances, pending })
}
