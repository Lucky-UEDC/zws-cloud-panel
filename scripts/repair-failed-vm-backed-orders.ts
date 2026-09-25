import "dotenv/config"
import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"
import { createProxmoxClient } from "@/lib/proxmox"
import { STEP_LABELS } from "@/lib/provisioning-status"

function flagArg(name: string) {
  return process.argv.includes(name)
}

function valueArg(name: string, fallback = "") {
  const prefixed = process.argv.find((arg) => arg.startsWith(`${name}=`))
  if (prefixed) return prefixed.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] || fallback : fallback
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

function safeMessage(error: unknown) {
  return String((error as any)?.message || error || "Unknown error")
    .replace(/PVEAPIToken=[^\s"'<>]+/gi, "PVEAPIToken=[redacted]")
    .replace(/\btoken(secret)?["':=\s]+[^"',\s}]+/gi, "token=[redacted]")
    .slice(0, 240)
}

function firstGuestIpv4(interfaces: any) {
  const rows = Array.isArray(interfaces?.result) ? interfaces.result : Array.isArray(interfaces) ? interfaces : []
  for (const iface of rows) {
    const addresses = Array.isArray(iface?.["ip-addresses"]) ? iface["ip-addresses"] : []
    for (const item of addresses) {
      const ip = String(item?.["ip-address"] || "")
      if (item?.["ip-address-type"] === "ipv4" && ip && !ip.startsWith("127.") && !ip.startsWith("169.254.")) return ip
    }
  }
  return null
}

async function main() {
  const apply = flagArg("--apply")
  const limit = Math.max(1, Math.min(500, Number(valueArg("--limit", "100"))))
  const orders = await prisma.order.findMany({
    where: {
      deletedAt: null,
      OR: [
        { status: { in: ["failed", "provisioning_failed", "error"] } },
        { provisioningStatus: { in: ["FAILED", "failed", "START_FAILED", "REPAIR_NEEDED"] } },
        { provisioningError: { not: null } },
        { vpsInstance: { is: { status: { in: ["FAILED", "failed", "PROVISIONING_FAILED"] } } } },
      ],
      AND: [
        {
          OR: [
            { vmId: { not: null } },
            { vpsInstance: { isNot: null } },
          ],
        },
      ],
    },
    include: {
      customer: { select: { id: true, email: true, name: true } },
      invoices: true,
      payments: { orderBy: { createdAt: "desc" }, take: 5 },
      vpsInstance: { include: { proxmoxNode: true, ipAllocations: true, provisioningJobs: { orderBy: { createdAt: "desc" }, take: 3 } } },
      proxmoxServer: true,
      provisioningJobs: { orderBy: { createdAt: "desc" }, take: 3 },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  })

  const repaired: any[] = []
  const skipped: any[] = []

  for (const order of orders) {
    const vps = order.vpsInstance
    const node = vps?.proxmoxNode || order.proxmoxServer
    const vmid = Number(vps?.vmid || order.vmId || 0)
    const evidence: Record<string, unknown> = { orderId: order.id, orderNumber: order.orderNumber, vmid }
    const changes: string[] = []
    const warnings: string[] = []
    if (!node || !vmid) {
      skipped.push({ orderId: order.id, reason: "missing_node_or_vmid", evidence })
      continue
    }

    const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, {
      allowInsecureTls: node.allowInsecureTls,
      timeoutMs: 8000,
    })
    const runtime = await client.getVMStatus(node.nodeName, vmid).catch((error) => ({ __error: safeMessage(error) }))
    evidence.runtime = runtime
    if ((runtime as any).__error) {
      skipped.push({ orderId: order.id, reason: "vm_status_unreadable", evidence })
      continue
    }
    const runtimeStatus = String((runtime as any)?.status || "").toLowerCase()
    if (!runtimeStatus) {
      skipped.push({ orderId: order.id, reason: "vm_not_found", evidence })
      continue
    }

    let repairedIp = vps?.ipAddress || null
    let allocation = vps?.ipAllocations?.find((row) => ["assigned", "active", "used", "reserved"].includes(String(row.status || "").toLowerCase())) || null
    if (!allocation) {
      allocation = await prisma.ipAllocation.findFirst({
        where: {
          OR: [{ vmid }, ...(vps?.id ? [{ vpsInstanceId: vps.id }] : [])],
          status: { in: ["assigned", "active", "used", "reserved"] },
        },
        orderBy: { updatedAt: "desc" },
      }).catch(() => null)
    }
    if (!repairedIp && allocation?.ipAddress) repairedIp = allocation.ipAddress
    if (!repairedIp) {
      const guestInterfaces = await client.getVMGuestNetworkInterfaces(node.nodeName, vmid).catch(() => null)
      repairedIp = firstGuestIpv4(guestInterfaces)
      evidence.guestIpDetected = repairedIp || null
    }
    if (!repairedIp) warnings.push("missing_ip")

    const username = vps?.username || vps?.adminUsername || order.adminUsername || null
    const passwordEncrypted = vps?.passwordEncrypted || order.passwordEncrypted || null
    if (!username) warnings.push("missing_username")
    if (!passwordEncrypted) warnings.push("missing_password")

    const paidPayment = order.payments.find((payment) => ["completed", "paid", "success"].includes(String(payment.status || "").toLowerCase()))
    const invoicePaid = !order.invoices || ["paid", "completed"].includes(String(order.invoices.status || "").toLowerCase())
    if (!invoicePaid && !paidPayment && !["paid", "payment_verified", "active"].includes(String(order.status || "").toLowerCase())) warnings.push("invoice_not_paid")

    const [emailLog, deliveryLog] = await Promise.all([
      prisma.emailLog.findFirst({
        where: { metadata: { path: ["orderId"], equals: order.id } },
        orderBy: { createdAt: "desc" },
      }).catch(() => null),
      prisma.notificationDeliveryLog.findFirst({
        where: { metadata: { path: ["orderId"], equals: order.id } },
        orderBy: { createdAt: "desc" },
      }).catch(() => null),
    ])
    evidence.emailLogPresent = Boolean(emailLog)
    evidence.notificationLogPresent = Boolean(deliveryLog)

    if (apply) {
      if (vps) {
        const vpsData: Record<string, any> = {
          status: "ACTIVE",
          proxmoxNodeId: node.id,
          activatedAt: vps.activatedAt || new Date(),
          lifecycleMetadata: {
            ...record(vps.lifecycleMetadata),
            failedOrderRepair: { repairedAt: new Date().toISOString(), warnings, runtimeStatus },
          },
        }
        if (repairedIp && !vps.ipAddress) vpsData.ipAddress = repairedIp
        if (!vps.username && order.adminUsername) vpsData.username = order.adminUsername
        if (!vps.adminUsername && order.adminUsername) vpsData.adminUsername = order.adminUsername
        if (!vps.passwordEncrypted && order.passwordEncrypted) vpsData.passwordEncrypted = order.passwordEncrypted
        await prisma.vpsInstance.update({ where: { id: vps.id }, data: vpsData })
        changes.push("vps:ACTIVE")
      }
      if (allocation && vps?.id && allocation.vpsInstanceId !== vps.id) {
        await prisma.ipAllocation.update({ where: { id: allocation.id }, data: { vpsInstanceId: vps.id, vmid, status: "assigned", nodeId: node.id } })
        changes.push("ip_allocation:linked")
      }
      if (order.invoices && !invoicePaid && paidPayment) {
        await prisma.invoice.update({ where: { id: order.invoices.id }, data: { status: "paid", paidAt: order.invoices.paidAt || paidPayment.createdAt || new Date() } })
        changes.push("invoice:paid")
      }
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: "active",
          provisioningStatus: "ACTIVE",
          provisioningError: null,
          provisionedAt: order.provisionedAt || new Date(),
          vmId: vmid,
          proxmoxNodeId: node.id,
          proxmoxNode: node.nodeName,
          serviceId: vps?.id || order.serviceId,
          metadata: {
            ...record(order.metadata),
            failedVmBackedOrderRepair: { repairedAt: new Date().toISOString(), warnings, runtimeStatus, ipAddress: repairedIp || null },
          },
        },
      })
      changes.push("order:active")
      const jobs = [...(vps?.provisioningJobs || []), ...order.provisioningJobs]
      for (const job of jobs.filter((item, index, all) => item?.id && all.findIndex((other) => other?.id === item.id) === index)) {
        await prisma.provisioningJob.update({
          where: { id: job.id },
          data: {
            status: "completed",
            currentStep: "ACTIVE",
            displayStatus: STEP_LABELS.ACTIVE,
            error: null,
            errorCode: null,
            vpsInstanceId: vps?.id || job.vpsInstanceId,
            customerId: order.customerId || job.customerId,
            proxmoxNodeId: node.id,
            nodeName: node.nodeName,
            vmid,
            dedupeKey: null,
            completedAt: job.completedAt || new Date(),
          },
        }).catch(() => null)
      }
      if (!emailLog && order.customer?.email) {
        await prisma.emailLog.create({
          data: {
            templateKey: "service_provisioned_repair",
            recipient: order.customer.email,
            subject: `Service active: ${order.orderNumber}`,
            status: "queued",
            metadata: { orderId: order.id, vpsInstanceId: vps?.id || null, source: "failed_vm_backed_order_repair" },
          },
        }).catch(() => null)
        changes.push("email_log:queued")
      }
      if (!deliveryLog) {
        await prisma.notificationDeliveryLog.create({
          data: {
            eventType: "vm_provisioned",
            channel: "system",
            recipient: order.customer?.email || null,
            status: "queued",
            metadata: { orderId: order.id, vpsInstanceId: vps?.id || null, source: "failed_vm_backed_order_repair" },
          },
        }).catch(() => null)
        changes.push("notification_log:queued")
      }
      await createPanelLog({
        category: "Provisioning",
        level: warnings.length ? "warn" : "info",
        message: "failed_vm_backed_order_repaired",
        customerId: order.customerId || undefined,
        orderId: order.id,
        metadata: { vmid, nodeId: node.id, changes, warnings },
      }).catch(() => null)
    } else {
      changes.push("dry_run")
    }

    repaired.push({ orderId: order.id, orderNumber: order.orderNumber, vpsInstanceId: vps?.id || null, vmid, runtimeStatus, ipAddress: repairedIp || null, warnings, changes, evidence })
  }

  console.log(JSON.stringify({ dryRun: !apply, scanned: orders.length, repairedCount: repaired.length, skippedCount: skipped.length, repaired, skipped }, null, 2))
}

main()
  .catch((error) => {
    console.error("[repair-failed-vm-backed-orders] failed", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
