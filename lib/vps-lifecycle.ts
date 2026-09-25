import { prisma } from "@/lib/db"
import { createProxmoxClient, PROXMOX_LONG_TIMEOUT_MS } from "@/lib/proxmox"
import { freeVpsIp } from "@/lib/ip-pool"
import { writeAuditLog } from "@/lib/audit-log"
import { createPanelLog } from "@/lib/panel-log"
import { requestVmDeletion } from "@/lib/vm-deletion"

const PROVISIONING = new Set([
  "CREATING",
  "SELECTING_NODE",
  "WAITING_FOR_CAPACITY",
  "WAITING_FOR_ADMIN",
  "CLONING_TEMPLATE",
  "RESIZING_DISK",
  "ASSIGNING_IP",
  "APPLYING_CLOUD_INIT",
  "STARTING_VM",
  "VERIFYING_VM",
  "REINSTALLING",
  "UPGRADE_QUEUED",
  "UPDATING_CONFIG",
])

export function mapLiveVpsStatus(runtime: any, provisioningStatus?: string | null, dbStatus?: string | null) {
  const prov = String(provisioningStatus || "").toUpperCase()
  const db = String(dbStatus || "").toUpperCase()
  if (db === "DELETED" || db === "TERMINATED") return { status: db, displayStatus: db === "TERMINATED" ? "Terminated" : "Deleted", overloaded: false }
  if (db === "MISSING") return { status: "MISSING", displayStatus: "Missing", overloaded: false }
  if (db === "SUSPENDED" || db === "PENDING_TERMINATION" || String(runtime?.status || "").toLowerCase() === "suspended") {
    return { status: db === "PENDING_TERMINATION" ? "PENDING_TERMINATION" : "SUSPENDED", displayStatus: db === "PENDING_TERMINATION" ? "Pending termination" : "Suspended", overloaded: false }
  }
  const runtimeStatus = String(runtime?.status || "").toLowerCase()
  const cpuPercent = Math.max(0, Math.min(100, Number(runtime?.cpu || 0) * 100))
  const ramPercent = Number(runtime?.maxmem || 0) > 0 ? Math.max(0, Math.min(100, (Number(runtime?.mem || 0) / Number(runtime.maxmem)) * 100)) : 0
  const overloaded = cpuPercent > 90 || ramPercent > 90
  if (overloaded) return { status: "OVERLOADED", displayStatus: "Overloaded", overloaded: true }
  if (runtimeStatus === "running") return { status: "ACTIVE", displayStatus: "Active", overloaded: false }
  if (runtimeStatus === "stopped") return { status: "STOPPED", displayStatus: "Stopped", overloaded: false }
  if (runtimeStatus === "paused") return { status: "PAUSED", displayStatus: "Paused", overloaded: false }
  if (PROVISIONING.has(prov) || PROVISIONING.has(db)) {
    const configuring = ["APPLYING_CLOUD_INIT", "VERIFYING_VM", "UPDATING_CONFIG"].includes(prov) || ["APPLYING_CLOUD_INIT", "VERIFYING_VM", "UPDATING_CONFIG"].includes(db)
    return { status: configuring ? "CONFIGURING" : "INSTALLING", displayStatus: configuring ? "Configuring" : "Installing", overloaded: false }
  }
  return { status: db || "UNKNOWN", displayStatus: db || "Unknown", overloaded: false }
}

export function customerFacingVpsStatus(status?: string | null, provisioningStatus?: string | null) {
  const value = String(status || "").toUpperCase()
  const prov = String(provisioningStatus || "").toUpperCase()
  if (["TERMINATED", "DELETED"].includes(value)) return "Deleted"
  if (value === "MISSING" || prov === "MISSING") return "Missing"
  if (["SUSPENDED"].includes(value)) return "Suspended"
  if (["PENDING_TERMINATION"].includes(value)) return "Suspended"
  if (["STOPPED", "PAUSED"].includes(value)) return "Stopped"
  if (["REBOOTING"].includes(value)) return "Provisioning"
  if (["UPGRADE", "UPGRADE_QUEUED", "UPDATING_CONFIG"].includes(value) || ["UPGRADE", "UPGRADE_QUEUED", "UPDATING_CONFIG"].includes(prov)) return "Provisioning"
  if (["REINSTALLING"].includes(value) || ["REINSTALLING"].includes(prov)) return "Reinstalling"
  if (["FAILED", "START_FAILED", "REPAIR_NEEDED", "UPGRADE_FAILED"].includes(value) || ["FAILED", "START_FAILED", "REPAIR_NEEDED", "UPGRADE_FAILED"].includes(prov)) return "Failed"
  if (["WAITING_FOR_ADMIN", "WAITING_FOR_CAPACITY"].includes(value) || ["WAITING_FOR_ADMIN", "WAITING_FOR_CAPACITY"].includes(prov)) return "Provisioning"
  if (["CREATING", "INSTALLING", "CONFIGURING", "QUEUED", "SELECTING_NODE", "CLONING_TEMPLATE", "RESIZING_DISK", "ASSIGNING_IP", "APPLYING_CLOUD_INIT", "STARTING_VM", "VERIFYING_VM"].includes(value) || ["CREATING", "QUEUED", "SELECTING_NODE", "CLONING_TEMPLATE", "RESIZING_DISK", "ASSIGNING_IP", "APPLYING_CLOUD_INIT", "STARTING_VM", "VERIFYING_VM"].includes(prov)) return "Provisioning"
  if (["ACTIVE", "RUNNING", "OVERLOADED"].includes(value)) return "Active"
  return "Provisioning"
}

export async function getLiveVpsSnapshot(vps: any) {
  const node = vps.proxmoxNode || null
  let runtime: any = null
  if (node && vps.vmid && String(vps.status || "").toUpperCase() !== "DELETED") {
    const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, {
      allowInsecureTls: node.allowInsecureTls,
    })
    runtime = await client.getVMStatus(node.nodeName, vps.vmid).catch(() => null)
  }
  const mapped = mapLiveVpsStatus(runtime, vps.order?.provisioningStatus, vps.status)
  return { runtime, ...mapped }
}

async function waitForStopped(client: ReturnType<typeof createProxmoxClient>, nodeName: string, vmid: number) {
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    const runtime = await client.getVMStatus(nodeName, vmid).catch(() => null)
    const state = String(runtime?.status || "").toLowerCase()
    if (!state || state === "stopped") return runtime
    await new Promise((resolve) => setTimeout(resolve, 2500))
  }
  return client.getVMStatus(nodeName, vmid).catch(() => null)
}

export async function deleteOrderAndCleanupService(orderId: string, input: { actorEmail?: string | null; adminId?: string | null } = {}) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      vpsInstance: { include: { proxmoxNode: true } },
      dedicatedService: true,
      provisioningJobs: { select: { id: true, status: true } },
    },
  })
  if (!order) throw new Error("Order not found")

  if (order.deletedAt && String(order.status || "").toUpperCase() === "DELETED") {
    return { order, vpsInstance: order.vpsInstance, dedicatedService: order.dedicatedService, terminatedVps: false, alreadyDeleted: true }
  }

  const orderInvoices = await prisma.invoice.findMany({
    where: { orderId: order.id },
    select: { id: true, status: true, paidAt: true },
  })
  const preservedFinancialRecords = {
    invoices: orderInvoices.length,
    paidInvoices: orderInvoices.filter((invoice) => String(invoice.status).toLowerCase() === "paid" || invoice.paidAt).length,
    payments: await prisma.payment.count({ where: { orderId: order.id } }),
    paymentAttempts: await prisma.paymentAttempt.count({ where: { orderId: order.id } }),
  }

  if (order.vpsInstance) {
    const deletionJob = await requestVmDeletion({
      vpsId: order.vpsInstance.id,
      actorEmail: input.actorEmail || "system",
      reason: "order_delete_cleanup",
      mode: "delete_vm",
    })
    const [updatedOrder, updatedVps] = await Promise.all([
      prisma.order.findUnique({ where: { id: order.id } }),
      prisma.vpsInstance.findUnique({ where: { id: order.vpsInstance.id } }),
    ])
    return {
      order: updatedOrder || order,
      vpsInstance: updatedVps || order.vpsInstance,
      dedicatedService: order.dedicatedService,
      terminatedVps: String((deletionJob as any)?.status || "") === "deleted",
      releasedIps: null,
      preservedFinancialRecords,
      deletionJob,
    }
  }

  const vps: any = order.vpsInstance
  let proxmoxDeleted = false
  if (vps?.proxmoxNode && vps.vmid) {
    const client = createProxmoxClient(vps.proxmoxNode.host, vps.proxmoxNode.tokenId, vps.proxmoxNode.tokenSecret, {
      allowInsecureTls: vps.proxmoxNode.allowInsecureTls,
      timeoutMs: PROXMOX_LONG_TIMEOUT_MS,
    })
    const nodeName = vps.proxmoxNode.nodeName
    const runtime = await client.getVMStatus(nodeName, vps.vmid).catch(() => null)
    if (String(runtime?.status || "").toLowerCase() === "running") {
      await client.stopVM(nodeName, vps.vmid, { skiplock: true }).catch(() => undefined)
      const afterStop = await waitForStopped(client, nodeName, vps.vmid)
      if (String(afterStop?.status || "").toLowerCase() !== "stopped") {
        await client.stopVM(nodeName, vps.vmid, { skiplock: true }).catch(() => undefined)
        await waitForStopped(client, nodeName, vps.vmid)
      }
    }
    await client.deleteVM(nodeName, vps.vmid).catch((error) => {
      const message = String(error?.message || "")
      if (!message.includes("does not exist") && !message.includes("404")) throw error
    })
    proxmoxDeleted = true
  }

  const now = new Date()
  const releasedIps = vps ? await freeVpsIp(vps.id).catch(() => ({ count: 0 })) : { count: 0 }
  if (vps) {
    await prisma.vpsInstance.update({
      where: { id: vps.id },
      data: { status: "DELETED", deletedAt: now, deletionAt: now, ipAddress: null },
    })
  }

  const updatedOrder = await prisma.$transaction(async (tx) => {
    await tx.provisioningJob.updateMany({
      where: { orderId: order.id, status: { in: ["queued", "running", "waiting_for_admin", "WAITING_FOR_ADMIN"] } },
      data: { status: "cancelled", displayStatus: "Cancelled", error: "Order deleted by admin", completedAt: now },
    }).catch(() => ({ count: 0 }))
    if (order.dedicatedService) {
      await tx.dedicatedService.update({
        where: { id: order.dedicatedService.id },
        data: { status: "DELETED", cancelledAt: order.dedicatedService.cancelledAt || now },
      }).catch(() => null)
    }
    if (vps) {
      await tx.ipAllocation.updateMany({
        where: { vpsInstanceId: vps.id },
        data: { status: "free", vpsInstanceId: null, vmid: null, hostname: null, allocationLockKey: null, releasedAt: now },
      }).catch(() => ({ count: 0 }))
      await tx.vmIpAssignment.updateMany({
        where: { vpsInstanceId: vps.id },
        data: { status: "released", detachedAt: now },
      }).catch(() => ({ count: 0 }))
      await tx.vmNetworkInterface.updateMany({
        where: { vpsInstanceId: vps.id },
        data: { metadata: { deletedAt: now.toISOString(), source: "order_delete_cleanup" } as any },
      }).catch(() => ({ count: 0 }))
      await tx.vmNetworkEvent.create({
        data: {
          vpsInstanceId: vps.id,
          proxmoxNodeId: vps.proxmoxNodeId,
          vmid: vps.vmid,
          eventType: "order_delete_cleanup",
          status: "completed",
          stage: "cleanup",
          actorEmail: input.actorEmail || null,
          result: {
            releasedIps: Number((releasedIps as any)?.count || 0),
            preservedFinancialRecords,
            cleanedAt: now.toISOString(),
          } as any,
        },
      }).catch(() => null)
      await tx.vpsInstance.update({
        where: { id: vps.id },
        data: { status: "DELETED", deletedAt: now, deletionAt: now, ipAddress: null, autoSuspendEnabled: false, autoDeleteEnabled: false },
      }).catch(() => null)
    }
    return tx.order.update({
      where: { id: order.id },
      data: {
        status: "DELETED",
        deletedAt: now,
        isActive: false,
        provisioningStatus: "DELETED",
        metadata: {
          ...((order.metadata && typeof order.metadata === "object" && !Array.isArray(order.metadata)) ? order.metadata as Record<string, unknown> : {}),
          deletedBy: input.actorEmail || "admin",
          deletedAt: now.toISOString(),
          cleanup: {
            proxmoxDeleted,
            releasedIps: Number((releasedIps as any)?.count || 0),
            preservedFinancialRecords,
            hadVps: Boolean(vps),
            hadDedicatedService: Boolean(order.dedicatedService),
          },
        },
      },
      include: { vpsInstance: true, dedicatedService: true },
    })
  })

  await writeAuditLog({
    action: "order.deleted",
    adminId: input.adminId || null,
    actorEmail: input.actorEmail || null,
    customerId: order.customerId || null,
    targetType: "order",
    targetId: order.id,
    oldValue: { status: order.status, deletedAt: order.deletedAt },
    newValue: { status: "DELETED", deletedAt: now.toISOString() },
    metadata: { proxmoxDeleted, releasedIps: Number((releasedIps as any)?.count || 0), preservedFinancialRecords, vpsInstanceId: vps?.id || null, vmid: vps?.vmid || null },
  }).catch(() => null)
  await createPanelLog({
    category: "ADMIN",
    message: "order_deleted",
    actorType: "admin",
    actorEmail: input.actorEmail || null,
    customerId: order.customerId || null,
    orderId: order.id,
    vpsInstanceId: vps?.id || null,
    vmid: vps?.vmid || null,
    metadata: { proxmoxDeleted, releasedIps: Number((releasedIps as any)?.count || 0), preservedFinancialRecords },
  }).catch(() => null)

  return { order: updatedOrder, vpsInstance: updatedOrder.vpsInstance, dedicatedService: updatedOrder.dedicatedService, terminatedVps: Boolean(vps), releasedIps, preservedFinancialRecords }
}
