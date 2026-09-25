import { prisma } from "@/lib/db"
import { assignableIpPoolStatus } from "@/lib/ip-pool"
import { withRedisLock } from "@/lib/redis"
import { validateProvisioningPreflight } from "@/lib/provisioning-placement"
import { assertPaymentVerifiedForProvisioning } from "@/lib/payment-state"

const PAID_ORDER_STATUSES = ["paid", "payment_verified", "active"]

export async function recoverIpBlockedProvisioning(input: {
  productIds?: string[]
  actor?: string
  fullPreflight?: boolean
}) {
  return withRedisLock("lock:provisioning-ipam-recovery", 4000, async () => recoverIpBlockedProvisioningUnlocked(input))
}

async function recoverIpBlockedProvisioningUnlocked(input: {
  productIds?: string[]
  actor?: string
  fullPreflight?: boolean
}) {
  const productIds = Array.from(new Set((input.productIds || []).map((id) => String(id || "").trim()).filter(Boolean)))
  const jobs = await prisma.provisioningJob.findMany({
    where: {
      type: "provision",
      status: "waiting_for_admin",
      OR: [
        { errorCode: "IP_POOL_UNAVAILABLE" },
        { error: { contains: "No IP pool assigned" } },
      ],
      order: {
        ...(productIds.length ? { productId: { in: productIds } } : { productId: { not: null } }),
        status: { in: PAID_ORDER_STATUSES },
      },
    },
    include: {
      order: {
        include: { product: true, customConfig: true, offer: true, operatingSystem: true },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  })

  let recovered = 0
  let stillBlocked = 0
  for (const job of jobs) {
    const order = job.order
    if (!order?.productId) continue
    const paymentGate = await assertPaymentVerifiedForProvisioning(order.id).catch((error: any) => ({ error: error?.message || "payment_not_verified" }))
    if ("error" in paymentGate) {
      await markStillBlocked(job, input.actor || "ipam_recovery", { reason: "payment_not_verified", message: paymentGate.error })
      stillBlocked += 1
      continue
    }
    const nodeIds = order.proxmoxNodeId || order.product?.defaultNodeId
      ? [String(order.proxmoxNodeId || order.product?.defaultNodeId)]
      : (await prisma.proxmoxNode.findMany({
          where: { isActive: true, status: { in: ["connected", "warning", "unknown"] } },
          select: { id: true },
        })).map((node) => node.id)

    let ipOk = false
    const ipChecks: any[] = []
    for (const proxmoxNodeId of nodeIds) {
      const status = await assignableIpPoolStatus({ proxmoxNodeId, productId: order.productId, allocationType: "default" }).catch(() => null)
      ipChecks.push({ proxmoxNodeId, ok: Boolean(status?.ok), errorCode: status?.errorCode || null, reason: status?.reason || null, poolIds: status?.pools?.map((pool: any) => pool.id) || [] })
      if (status?.ok) {
        ipOk = true
        break
      }
    }
    await logRecovery(job.id, {
      event: "ipam:checked",
      message: ipOk ? "IPAM relation check passed" : "IPAM relation check is still blocked",
      level: ipOk ? "info" : "warn",
      response: { checks: ipChecks, actor: input.actor || null },
    })
    if (!ipOk) {
      stillBlocked += 1
      await markStillBlocked(job, input.actor || "ipam_recovery", { ipChecks })
      continue
    }

    let preflight: any = null
    if (input.fullPreflight) {
      preflight = await validateProvisioningPreflight({
        nodeId: order.proxmoxNodeId || order.product?.defaultNodeId || null,
        vcpu: Number(order.product?.cpuCores || order.customConfig?.cpuCores || 1),
        ramGb: Number(order.product?.ramGb || order.customConfig?.ramGb || 1),
        storageGb: Number(order.product?.storageGb || (Array.isArray(order.customConfig?.disks) ? (order.customConfig!.disks as any[]).reduce((sum, disk) => sum + Number(disk?.sizeGb || 0), 0) : 0)),
        productId: order.productId,
        bandwidthTb: Number(order.product?.bandwidthTb || order.customConfig?.bandwidthTb || 0),
        osFamily: order.requestedOsFamily || order.operatingSystem?.osFamily || order.osName || null,
        osVersion: order.requestedOsVersion || order.operatingSystem?.osVersion || null,
        osTemplateId: order.operatingSystemId || null,
        nodeClassId: order.nodeClassId,
        storagePoolId: order.storagePoolId || order.offer?.storagePoolId || null,
        storagePolicyType: order.product?.storagePolicyType || order.product?.storagePoolPolicy || null,
        requiredStorageType: order.product?.requiredStorageType || order.product?.storageType || null,
        requiredStoragePoolId: order.product?.requiredStoragePoolId || order.product?.defaultStoragePoolId || null,
        allowStorageFallback: order.product?.allowStorageFallback,
        allowPremiumNewPurchase: Boolean(order.offerId),
      }).catch((error: any) => ({ ok: false, errorCode: "PREFLIGHT_EXCEPTION", reason: error?.message || "Provisioning preflight failed" }))
      await logRecovery(job.id, {
        event: "queue:config_revalidated",
        message: preflight.ok ? "Provisioning configuration revalidated" : "Provisioning configuration is still blocked",
        level: preflight.ok ? "info" : "warn",
        response: { preflight },
      })
      if (!preflight.ok) {
        stillBlocked += 1
        await markStillBlocked(job, input.actor || "ipam_recovery", { ipChecks, preflight })
        continue
      }
    }

    await prisma.provisioningJob.update({
      where: { id: job.id },
      data: {
        status: "queued",
        currentStep: "QUEUED",
        displayStatus: "Queued",
        error: null,
        errorCode: null,
        dedupeKey: job.dedupeKey || `provision:${order.id}`,
        nextRetryAt: null,
        claimedAt: null,
        completedAt: null,
        metadata: {
          ...((job.metadata as any) || {}),
          ipamRecoveredAt: new Date().toISOString(),
          ipamRecoveryActor: input.actor || "ipam_assignment",
          ipamRecoveryChecks: ipChecks,
          ...(preflight ? { ipamRecoveryPreflight: preflight } : {}),
        },
      },
    })
    await prisma.order.update({
      where: { id: order.id },
      data: { provisioningStatus: "QUEUED", provisioningError: null },
    }).catch(() => null)
    await logRecovery(job.id, {
      event: "queue:recovered",
      message: "IP-blocked provisioning job requeued after live DB validation",
      response: { actor: input.actor || null, preflight: preflight || null },
    })
    recovered += 1
  }

  return { scanned: jobs.length, recovered, stillBlocked }
}

async function markStillBlocked(job: any, actor: string, diagnostics: Record<string, unknown>) {
  await prisma.provisioningJob.update({
    where: { id: job.id },
    data: {
      metadata: {
        ...((job.metadata as any) || {}),
        lastIpamRecoveryScanAt: new Date().toISOString(),
        lastIpamRecoveryActor: actor,
        lastIpamRecoveryDiagnostics: diagnostics,
      },
    },
  }).catch(() => null)
  await logRecovery(job.id, {
    event: "queue:still_blocked",
    message: "Provisioning job remains blocked after live DB validation",
    level: "warn",
    response: diagnostics,
  })
}

async function logRecovery(jobId: string, input: { event: string; message: string; level?: string; response?: any }) {
  await prisma.provisioningTaskLog.create({
    data: {
      jobId,
      event: input.event,
      message: input.message,
      level: input.level || "info",
      response: input.response,
    },
  }).catch(() => null)
}
