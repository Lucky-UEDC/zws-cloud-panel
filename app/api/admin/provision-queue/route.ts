import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { assignableIpPoolStatus } from "@/lib/ip-pool"
import { readProvisionWorkerHeartbeat } from "@/lib/provision-worker-status"
import { getAdminFromCookies } from "@/lib/server-auth"
import { normalizeVmAutomationState, normalizeVmLifecycleState } from "@/lib/vm-state-machine"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const [jobs, counts, worker] = await Promise.all([
    prisma.provisioningJob.findMany({
      include: {
        order: { select: { id: true, orderNumber: true, status: true, provisioningStatus: true } },
        vpsInstance: { select: { id: true, name: true, status: true, vmid: true } },
        logs: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.provisioningJob.groupBy({ by: ["status", "type"], _count: { _all: true } }),
    readProvisionWorkerHeartbeat(),
  ])

  const summaries = jobs.map((job) => ({
    id: job.id,
    lifecycle: {
      serviceStatus: job.vpsInstance?.status || job.order?.provisioningStatus || job.status,
      orderNumber: job.order?.orderNumber || null,
    },
    automationState: normalizeVmAutomationState(job.status),
    stateMachine: {
      lifecycleState: normalizeVmLifecycleState(job.vpsInstance?.status || job.order?.provisioningStatus || job.status),
      automationState: normalizeVmAutomationState(job.status),
    },
    metricsSource: { runtime: "unavailable", cpu: "unavailable", memory: "unavailable", disk: "unavailable", network: "unavailable" },
    storageEnterprise: { source: "unavailable", health: "Unavailable", replicationStatus: "Unavailable" },
    networkIntelligence: null,
    diagnostics: {
      latestLog: job.logs[0]?.message || null,
      workerHealthy: Boolean(worker?.healthy),
      readiness: null as any,
    },
    activity: {
      latestLog: job.logs[0] || null,
    },
  }))

  await Promise.all(summaries.map(async (summary, index) => {
    const job = jobs[index]
    if (job.status !== "waiting_for_admin" || !job.order?.id) return
    const order = await prisma.order.findUnique({
      where: { id: job.order.id },
      select: { productId: true, proxmoxNodeId: true, product: { select: { defaultNodeId: true } } },
    }).catch(() => null)
    if (!order?.productId) return
    const nodeIds = order.proxmoxNodeId || order.product?.defaultNodeId
      ? [String(order.proxmoxNodeId || order.product?.defaultNodeId)]
      : (await prisma.proxmoxNode.findMany({
          where: { isActive: true, status: { in: ["connected", "warning", "unknown"] } },
          select: { id: true, nodeName: true },
        }).catch(() => [])).map((node) => node.id)
    const checks = await Promise.all(nodeIds.map(async (nodeId) => {
      const status = await assignableIpPoolStatus({ proxmoxNodeId: nodeId, productId: order.productId, allocationType: "default" }).catch((error: any) => ({ ok: false, errorCode: "READINESS_CHECK_FAILED", reason: error?.message || "Readiness check failed", pools: [] }))
      return {
        nodeId,
        ok: Boolean(status.ok),
        errorCode: status.errorCode || null,
        reason: status.reason || null,
        poolIds: (status.pools || []).map((pool: any) => pool.id),
      }
    }))
    summary.diagnostics.readiness = {
      productId: order.productId,
      nodeIds,
      checks,
      ok: checks.some((check) => check.ok),
    }
  }))

  return NextResponse.json({ success: true, jobs, counts, worker, summaries, checkedAt: new Date().toISOString() }, { headers: NO_CACHE_HEADERS })
}
