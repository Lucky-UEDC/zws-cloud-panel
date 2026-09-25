import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { prisma } from "@/lib/db"
import { createInvoiceForOrder } from "@/lib/invoices"
import { allocateIp, markIpUsed, reserveIpFromPool } from "@/lib/ip-pool"
import { isIpInRange, isIpInSubnet, validateIpRange } from "@/lib/ip-address"
import { isWindowsOsTemplate } from "@/lib/os-template-availability"
import { createPanelLog } from "@/lib/panel-log"
import { encryptSecret } from "@/lib/provision"
import { lifecycleDates } from "@/lib/renewals"
import { getAdminFromCookies } from "@/lib/server-auth"
import { persistVpsConsoleMetadata } from "@/lib/console-metadata"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

function text(value: unknown) {
  return String(value || "").trim()
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const orderId = text(body.orderId)
    const nodeId = text(body.nodeId)
    const vmid = Number(body.vmid || body.vmId || 0)
    const hostname = text(body.hostname)
    const notes = text(body.notes)
    const password = String(body.password || "")
    const usernameInput = text(body.username)
    const ipMode = text(body.ipAssignmentMode || body.ipMode || "automatic").toLowerCase()
    const requestedIp = text(body.ip || body.ipAddress || body.requestedIp)
    const poolId = text(body.poolId)

    if (!orderId || !nodeId || !vmid || !hostname || !password) {
      return NextResponse.json({ success: false, error: "orderId, nodeId, vmid, hostname, and password are required." }, { status: 400, headers: NO_CACHE_HEADERS })
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true, product: true, customConfig: true, operatingSystem: true, invoices: true, vpsInstance: true },
    })
    if (!order?.customerId || !order.customer) return NextResponse.json({ success: false, error: "Order/customer not found." }, { status: 404, headers: NO_CACHE_HEADERS })
    const node = await prisma.proxmoxNode.findFirst({ where: { id: nodeId, isActive: true } })
    if (!node) return NextResponse.json({ success: false, error: "Selected node is unavailable or inactive." }, { status: 400, headers: NO_CACHE_HEADERS })

    const username = usernameInput || (order.operatingSystem && isWindowsOsTemplate(order.operatingSystem) ? "Administrator" : "root")
    const passwordEncrypted = encryptSecret(password)
    const cpuCores = Number(order.product?.cpuCores || order.customConfig?.cpuCores || 1)
    const ramGb = Number(order.product?.ramGb || order.customConfig?.ramGb || 1)
    const diskGb = Number(order.product?.storageGb || (Array.isArray(order.customConfig?.disks) ? (order.customConfig!.disks as any[]).reduce((sum, disk) => sum + Number(disk?.sizeGb || 0), 0) : 20))

    const invoice = order.invoices || await createInvoiceForOrder(order.id).catch(() => null)
    const dates = lifecycleDates({ orderCreatedAt: order.createdAt, termMonths: Math.max(1, Number(order.termMonths || 1)), graceDays: 2, retentionDays: 7 })
    const vps = await prisma.vpsInstance.upsert({
      where: { orderId: order.id },
      update: {
        customerId: order.customerId,
        productId: order.productId,
        proxmoxNodeId: node.id,
        operatingSystemId: order.operatingSystemId || null,
        vmid,
        name: hostname,
        status: "ACTIVE",
        username,
        adminUsername: username,
        passwordEncrypted,
        accessMethod: "PASSWORD",
        cpuCores,
        ramGb,
        diskGb,
        activatedAt: new Date(),
        renewalDueAt: dates.renewalDueAt,
        nextRenewalAt: dates.renewalDueAt,
        suspendAt: dates.suspendAt,
        penaltyAt: dates.penaltyAt,
        terminationAt: dates.terminationAt,
        deletionAt: dates.deletionAt,
        provisioningSource: "manual_delivery",
        provisionMode: "linked",
        ownershipStatus: "panel_owned",
        ownershipEvidence: { manualDelivery: true, actor: admin.email, nodeId: node.id, vmid, deliveredAt: new Date().toISOString() },
      },
      create: {
        customerId: order.customerId,
        orderId: order.id,
        productId: order.productId,
        proxmoxNodeId: node.id,
        operatingSystemId: order.operatingSystemId || null,
        vmid,
        name: hostname,
        status: "ACTIVE",
        username,
        adminUsername: username,
        passwordEncrypted,
        accessMethod: "PASSWORD",
        cpuCores,
        ramGb,
        diskGb,
        activatedAt: new Date(),
        renewalDueAt: dates.renewalDueAt,
        nextRenewalAt: dates.renewalDueAt,
        suspendAt: dates.suspendAt,
        penaltyAt: dates.penaltyAt,
        terminationAt: dates.terminationAt,
        deletionAt: dates.deletionAt,
        provisioningSource: "manual_delivery",
        provisionMode: "linked",
        ownershipStatus: "panel_owned",
        ownershipEvidence: { manualDelivery: true, actor: admin.email, nodeId: node.id, vmid, deliveredAt: new Date().toISOString() },
      },
    })
    await persistVpsConsoleMetadata({ vpsId: vps.id, template: order.operatingSystem })

    let allocation: any = null
    if (ipMode === "automatic") {
      allocation = await allocateIp({ proxmoxNodeId: node.id, productId: order.productId, vpsInstanceId: vps.id, vmid, hostname, assignedBy: String(admin.email) })
    } else if (ipMode === "manual_select") {
      if (!poolId || !requestedIp) throw new Error("Pool and IP are required for manual select.")
      allocation = await reserveIpFromPool({ poolId, proxmoxNodeId: node.id, productId: order.productId, requestedIp, vpsInstanceId: vps.id, vmid, hostname, assignedBy: String(admin.email) })
    } else if (ipMode === "manual_enter") {
      const gateway = text(body.gateway)
      const dns = text(body.dns)
      const cidr = Number(body.cidr || body.subnet || 24)
      if (!requestedIp || !gateway || !dns || !Number.isInteger(cidr)) throw new Error("IP, gateway, subnet/CIDR, and DNS are required for manual entry.")
      validateIpRange(requestedIp, requestedIp)
      validateIpRange(gateway, gateway)
      const pools = await prisma.ipPool.findMany({ where: { isActive: true } })
      const pool = (poolId ? pools.find((item) => item.id === poolId) : pools.find((item) => isIpInRange(requestedIp, item.startIp, item.endIp))) || null
      if (!pool) throw new Error("Manual IP must exist in an active pool.")
      if (!isIpInRange(requestedIp, pool.startIp, pool.endIp) || !isIpInSubnet(gateway, requestedIp, cidr)) throw new Error("Manual IP network details are invalid.")
      const duplicate = await prisma.ipAllocation.findFirst({ where: { ipAddress: requestedIp, status: { in: ["reserved", "RESERVED", "assigned", "ASSIGNED", "USED", "used", "blocked", "BLOCKED"] } } })
      if (duplicate) throw new Error("Manual IP is already assigned or reserved.")
      allocation = await prisma.ipAllocation.upsert({
        where: { poolId_ipAddress: { poolId: pool.id, ipAddress: requestedIp } },
        create: { poolId: pool.id, nodeId: node.id, ipAddress: requestedIp, allocationType: "default", status: "reserved", vpsInstanceId: vps.id, vmid, hostname, assignedBy: String(admin.email), allocationLockKey: `${pool.id}:${requestedIp}` },
        update: { nodeId: node.id, status: "reserved", vpsInstanceId: vps.id, vmid, hostname, assignedBy: String(admin.email), allocationLockKey: `${pool.id}:${requestedIp}`, releasedAt: null },
        include: { pool: true },
      })
    } else {
      throw new Error("Unsupported IP assignment mode.")
    }

    if (allocation) {
      await markIpUsed(allocation.id, vps.id, vmid)
      await prisma.vpsInstance.update({ where: { id: vps.id }, data: { ipAddress: allocation.ipAddress } })
    }

    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: "active",
        provisioningStatus: "MANUALLY_DELIVERED",
        provisioningError: null,
        provisionedAt: new Date(),
        serviceId: vps.id,
        proxmoxNodeId: node.id,
        proxmoxNode: node.nodeName,
        vmId: vmid,
        hostname,
        adminUsername: username,
        passwordEncrypted,
        metadata: { ...((order.metadata as any) || {}), manualDelivery: { actor: admin.email, deliveredAt: new Date().toISOString(), notes, invoiceId: invoice?.id || null } },
      },
    })
    if (invoice?.id) await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "paid", paidAt: new Date(), manualProcessedBy: String(admin.email), manualProcessedAt: new Date(), manualReason: "Manual VM delivery" } }).catch(() => null)

    await createPanelLog({ category: "Provisioning", message: "vm_manually_delivered", actorType: "admin", actorEmail: String(admin.email), customerId: order.customerId, orderId: order.id, vpsInstanceId: vps.id, vmid, metadata: { nodeId: node.id, ip: allocation?.ipAddress || null, notes } }).catch(() => null)
    return NextResponse.json({ success: true, orderId: order.id, vpsInstanceId: vps.id, vmid, ip: allocation?.ipAddress || null, username }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Manual delivery failed" }, { status: 400, headers: NO_CACHE_HEADERS })
  }
}
