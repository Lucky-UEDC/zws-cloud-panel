import { prisma } from "@/lib/db"
import crypto from "node:crypto"
import { allocateIp, markIpUsed } from "@/lib/ip-pool"
import { enqueueProvisioningJob, encryptSecret } from "@/lib/provision"
import { repairPaidOrderVmLink } from "@/lib/admin-vm-management"
import { createPanelLog } from "@/lib/panel-log"
import { isWindowsOsTemplate } from "@/lib/os-template-availability"

const PAID_STATUSES = ["paid", "active", "completed", "payment_verified"]
const RECOVERABLE_ORDER_STATUSES = ["queued", "pending", "failed", "waiting_review", "manual_review", "provision_pending"]
const RECOVERABLE_PROVISIONING_STATUSES = [
  "queued",
  "pending",
  "failed",
  "waiting_review",
  "manual_review",
  "provision_pending",
  "waiting_for_admin",
  "WAITING_FOR_ADMIN",
  "FAILED",
  "QUEUED",
]
const RECOVERABLE_JOB_STATUSES = ["queued", "retrying", "failed", "waiting_for_admin", "waiting_review", "manual_review", "provision_pending"]

type RecoveryResult = {
  orderId: string
  orderNumber?: string | null
  repaired: boolean
  requeued: boolean
  skipped: boolean
  reason?: string
  jobId?: string | null
  repairs: string[]
}

function normalize(value: unknown) {
  return String(value || "").trim().toLowerCase()
}

function generatedRecoveryPassword() {
  return crypto.randomBytes(18).toString("base64url")
}

async function repairExistingService(order: any, repairs: string[]) {
  const vps = order.vpsInstance
  if (!vps || vps.deletedAt) return
  const orderPatch: Record<string, any> = {}
  const vpsPatch: Record<string, any> = {}

  if (!order.serviceId || order.serviceId !== vps.id) {
    orderPatch.serviceId = vps.id
    repairs.push("order_service_link")
  }
  if (!order.vmId && vps.vmid) {
    orderPatch.vmId = vps.vmid
    repairs.push("order_vmid")
  }
  if (!order.proxmoxNodeId && vps.proxmoxNodeId) {
    orderPatch.proxmoxNodeId = vps.proxmoxNodeId
    repairs.push("order_node")
  }
  if (!order.proxmoxNode && vps.proxmoxNode?.nodeName) {
    orderPatch.proxmoxNode = vps.proxmoxNode.nodeName
    repairs.push("order_node_name")
  }
  if (!vps.ipAddress) {
    const assigned = await (prisma as any).vmIpAssignment.findFirst({
      where: { vpsInstanceId: vps.id, isPrimary: true, status: { in: ["ACTIVE", "USED", "ASSIGNED", "active", "used", "assigned"] } },
      orderBy: { createdAt: "desc" },
    }).catch(() => null)
    const ipAddress = assigned?.ipAddress || null
    if (ipAddress) {
      vpsPatch.ipAddress = ipAddress
      repairs.push("vps_ip")
    } else if (vps.proxmoxNodeId && vps.vmid) {
      const allocation = await allocateIp({
        proxmoxNodeId: vps.proxmoxNodeId,
        productId: order.productId || null,
        vpsInstanceId: vps.id,
        vmid: vps.vmid,
        hostname: vps.name || order.hostname || order.orderNumber,
        assignedBy: "repair-all-orders",
        purpose: "provisioning",
      }).catch(() => null)
      if (allocation) {
        await markIpUsed(allocation.id, vps.id, vps.vmid).catch(() => null)
        vpsPatch.ipAddress = allocation.ipAddress
        repairs.push("vps_ip_allocated")
      }
    }
  }
  if (!vps.username && !vps.adminUsername) {
    const username = order.adminUsername || (isWindowsOsTemplate(order.operatingSystem) ? "Administrator" : "root")
    vpsPatch.username = username
    vpsPatch.adminUsername = username
    orderPatch.adminUsername = username
    repairs.push("credentials_username")
  }
  if (!vps.passwordEncrypted && !order.passwordEncrypted) {
    const passwordEncrypted = encryptSecret(generatedRecoveryPassword())
    vpsPatch.passwordEncrypted = passwordEncrypted
    orderPatch.passwordEncrypted = passwordEncrypted
    repairs.push("credentials_password")
  } else if (!vps.passwordEncrypted && order.passwordEncrypted) {
    vpsPatch.passwordEncrypted = order.passwordEncrypted
    repairs.push("vps_credentials")
  } else if (!order.passwordEncrypted && vps.passwordEncrypted) {
    orderPatch.passwordEncrypted = vps.passwordEncrypted
    repairs.push("order_credentials")
  }
  const hasVmAndIp = Boolean(vps.vmid && (vps.ipAddress || vpsPatch.ipAddress))
  const [identity, latestJob] = hasVmAndIp
    ? await Promise.all([
        (prisma as any).vmProvisioningIdentity.findUnique({ where: { orderId: order.id }, select: { phase: true } }).catch(() => null),
        prisma.provisioningJob.findFirst({
          where: { orderId: order.id, type: "provision" },
          orderBy: { createdAt: "desc" },
          include: { steps: { where: { step: "VERIFYING_VM", status: "completed" }, take: 1 } },
        }).catch(() => null),
      ])
    : [null, null]
  const deliveryProven = Boolean(
    order.provisionedAt ||
    vps.activatedAt ||
    (
      String(identity?.phase || "").toUpperCase() === "READY" &&
      String(latestJob?.status || "").toLowerCase() === "completed" &&
      Number(latestJob?.progress || 0) >= 100 &&
      Boolean(latestJob?.steps?.length)
    )
  )
  if (hasVmAndIp && deliveryProven && ["active", "running", "stopped"].includes(normalize(vps.status)) && normalize(order.provisioningStatus) !== "active") {
    orderPatch.provisioningStatus = "ACTIVE"
    orderPatch.provisioningError = null
    orderPatch.status = "active"
    vpsPatch.status = normalize(vps.status) === "stopped" ? "STOPPED" : "ACTIVE"
    repairs.push("provisioning_status")
  }

  if (Object.keys(orderPatch).length) {
    await prisma.order.update({ where: { id: order.id }, data: orderPatch }).catch(() => null)
  }
  if (Object.keys(vpsPatch).length) {
    await prisma.vpsInstance.update({ where: { id: vps.id }, data: vpsPatch }).catch(() => null)
  }
  if (hasVmAndIp && deliveryProven) {
    await prisma.provisioningJob.updateMany({
      where: { orderId: order.id, vpsInstanceId: vps.id, status: { in: ["queued", "running", "retrying", "failed", "waiting_for_admin"] } },
      data: { status: "completed", currentStep: "ACTIVE", displayStatus: "Active", error: null, errorCode: null, completedAt: new Date(), dedupeKey: null },
    }).then((result) => {
      if (result.count) repairs.push("provisioning_jobs")
    }).catch(() => null)
    await prisma.invoice.updateMany({
      where: { orderId: order.id, deletedAt: null },
      data: { status: "paid" },
    }).catch(() => null)
  }
}

async function recoverOrder(order: any, actor: string): Promise<RecoveryResult> {
  const repairs: string[] = []
  if (!order.customerId) return { orderId: order.id, orderNumber: order.orderNumber, repaired: false, requeued: false, skipped: true, reason: "missing_customer", repairs }
  if (!order.product && !order.customConfig) return { orderId: order.id, orderNumber: order.orderNumber, repaired: false, requeued: false, skipped: true, reason: "missing_product", repairs }

  await repairExistingService(order, repairs)
  if (!order.vpsInstance) {
    const repair = await repairPaidOrderVmLink({ orderId: order.id, actorEmail: actor }).catch((error: any) => ({ repaired: false, reason: error?.message || "vm_link_repair_failed" }))
    if ((repair as any).repaired) repairs.push("missing_vm")
  }

  const refreshed = await prisma.order.findUnique({
    where: { id: order.id },
    include: { vpsInstance: true },
  })
  if (refreshed?.vpsInstance && normalize(refreshed.provisioningStatus) === "active") {
    return { orderId: order.id, orderNumber: order.orderNumber, repaired: repairs.length > 0, requeued: false, skipped: false, reason: "already_active", repairs }
  }

  const job = await enqueueProvisioningJob(order.id, actor, { retryBlocked: true, nodeId: null }).catch((error: any) => ({ id: null, error: error?.message || "enqueue_failed" }))
  if ((job as any).error) {
    return { orderId: order.id, orderNumber: order.orderNumber, repaired: repairs.length > 0, requeued: false, skipped: false, reason: (job as any).error, repairs }
  }
  return { orderId: order.id, orderNumber: order.orderNumber, repaired: repairs.length > 0, requeued: true, skipped: false, jobId: (job as any).id || null, repairs }
}

export async function recoverProvisionableOrders(input: { actor?: string; limit?: number } = {}) {
  const actor = input.actor || "system:order-recovery"
  const limit = Math.max(1, Math.min(Number(input.limit || 50), 200))
  const orders = await prisma.order.findMany({
    where: {
      deletedAt: null,
      customerId: { not: null },
      status: { in: PAID_STATUSES },
      OR: [
        { status: { in: RECOVERABLE_ORDER_STATUSES } },
        { provisioningStatus: { in: RECOVERABLE_PROVISIONING_STATUSES } },
        { provisioningJobs: { some: { status: { in: RECOVERABLE_JOB_STATUSES } } } },
      ],
    },
    include: {
      product: true,
      customConfig: true,
      operatingSystem: true,
      vpsInstance: { include: { proxmoxNode: true } },
      provisioningJobs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
  })

  const results: RecoveryResult[] = []
  for (const order of orders) {
    results.push(await recoverOrder(order, actor).catch((error: any) => ({
      orderId: order.id,
      orderNumber: order.orderNumber,
      repaired: false,
      requeued: false,
      skipped: false,
      reason: error?.message || "recovery_failed",
      repairs: [],
    })))
  }

  const summary = {
    scanned: orders.length,
    repaired: results.filter((row) => row.repaired).length,
    requeued: results.filter((row) => row.requeued).length,
    skipped: results.filter((row) => row.skipped).length,
    failed: results.filter((row) => !row.skipped && !row.requeued && row.reason && row.reason !== "already_active").length,
    results,
  }
  await createPanelLog({
    category: "Provisioning",
    message: "order_auto_recovery_completed",
    actorType: actor.startsWith("system:") ? "system" : "admin",
    actorEmail: actor.startsWith("system:") ? null : actor,
    metadata: { scanned: summary.scanned, repaired: summary.repaired, requeued: summary.requeued, skipped: summary.skipped, failed: summary.failed },
  }).catch(() => null)
  return summary
}

export async function countRecoverableProvisioningOrders() {
  return prisma.order.count({
    where: {
      deletedAt: null,
      customerId: { not: null },
      status: { in: PAID_STATUSES },
      OR: [
        { status: { in: RECOVERABLE_ORDER_STATUSES } },
        { provisioningStatus: { in: RECOVERABLE_PROVISIONING_STATUSES } },
        { provisioningJobs: { some: { status: { in: RECOVERABLE_JOB_STATUSES } } } },
      ],
    },
  }).catch(() => 0)
}
