import "dotenv/config"
import { prisma } from "@/lib/db"
import { createProxmoxClient } from "@/lib/proxmox"
import { STEP_LABELS } from "@/lib/provisioning-status"

type ReconciledVps = {
  id: string
  orderId: string
  customerId: string
  changes: string[]
  runtimeStatus?: string | null
}

async function main() {
  const rows = await prisma.vpsInstance.findMany({
    include: {
      order: {
        select: {
          id: true,
          customerId: true,
          productId: true,
          operatingSystemId: true,
          serviceId: true,
          vmId: true,
          proxmoxNode: true,
          provisioningStatus: true,
          status: true,
          provisionedAt: true,
        },
      },
      proxmoxNode: true,
      provisioningJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, currentStep: true, status: true },
      },
    },
    orderBy: { createdAt: "asc" },
  })

  const fixed: ReconciledVps[] = []
  const skipped: Array<{ id: string; orderId: string; reason: string }> = []

  for (const vps of rows) {
    const order = vps.order
    if (!order?.customerId) {
      skipped.push({ id: vps.id, orderId: vps.orderId, reason: "order_missing_customer" })
      continue
    }

    const vpsData: Record<string, unknown> = {}
    const orderData: Record<string, unknown> = {}
    const changes: string[] = []
    let runtimeStatus: string | null | undefined

    if (vps.customerId !== order.customerId) {
      vpsData.customerId = order.customerId
      changes.push(`customerId:${vps.customerId}->${order.customerId}`)
    }
    if ((vps.productId || null) !== (order.productId || null)) {
      vpsData.productId = order.productId || null
      changes.push("productId")
    }
    if ((vps.operatingSystemId || null) !== (order.operatingSystemId || null)) {
      vpsData.operatingSystemId = order.operatingSystemId || null
      changes.push("operatingSystemId")
    }
    if (order.serviceId !== vps.id) {
      orderData.serviceId = vps.id
      changes.push("order.serviceId")
    }
    if (order.vmId !== vps.vmid) {
      orderData.vmId = vps.vmid
      changes.push("order.vmId")
    }
    if (vps.proxmoxNode?.nodeName && order.proxmoxNode !== vps.proxmoxNode.nodeName) {
      orderData.proxmoxNode = vps.proxmoxNode.nodeName
      changes.push("order.proxmoxNode")
    }

    if (vps.proxmoxNode?.host && vps.proxmoxNode.tokenId && vps.proxmoxNode.tokenSecret) {
      const client = createProxmoxClient(vps.proxmoxNode.host, vps.proxmoxNode.tokenId, vps.proxmoxNode.tokenSecret, {
        allowInsecureTls: vps.proxmoxNode.allowInsecureTls,
        timeoutMs: 5000,
      })
      const runtime = await client.getVMStatus(vps.proxmoxNode.nodeName, vps.vmid).catch(() => null)
      runtimeStatus = runtime?.status ? String(runtime.status).toLowerCase() : null
      if (runtimeStatus === "running") {
        if (vps.status !== "ACTIVE") {
          vpsData.status = "ACTIVE"
          changes.push("status:ACTIVE")
        }
        if (order.status !== "active" || order.provisioningStatus !== "ACTIVE") {
          orderData.status = "active"
          orderData.provisioningStatus = "ACTIVE"
          orderData.provisioningError = null
          orderData.provisionedAt = order.provisionedAt || new Date()
          changes.push("order.status:active")
        }
      }
    }

    if (Object.keys(vpsData).length > 0) {
      await prisma.vpsInstance.update({ where: { id: vps.id }, data: vpsData as any })
    }
    if (Object.keys(orderData).length > 0) {
      await prisma.order.update({ where: { id: order.id }, data: orderData as any })
    }
    if (runtimeStatus === "running" && vps.provisioningJobs[0]?.currentStep !== "ACTIVE") {
      await prisma.provisioningJob.update({
        where: { id: vps.provisioningJobs[0].id },
        data: {
          status: "completed",
          currentStep: "ACTIVE",
          displayStatus: STEP_LABELS.ACTIVE,
          error: null,
          vpsInstanceId: vps.id,
          customerId: order.customerId,
          dedupeKey: null,
          completedAt: new Date(),
        },
      })
      changes.push("job.currentStep:ACTIVE")
    }

    if (changes.length > 0) {
      fixed.push({
        id: vps.id,
        orderId: vps.orderId,
        customerId: order.customerId,
        changes,
        runtimeStatus,
      })
    }
  }

  const customerIds = Array.from(new Set(fixed.map((row) => row.customerId)))
  console.log(JSON.stringify({
    success: true,
    scanned: rows.length,
    fixedCount: fixed.length,
    customerIds,
    fixedVpsIds: fixed.map((row) => row.id),
    fixed,
    skipped,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error("[reconcile-vps-customers] failed", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
