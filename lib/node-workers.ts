import { prisma } from "@/lib/db"

const DEFAULT_SMALL_CLONE_LIMIT = 2
const DEFAULT_MEDIUM_CLONE_LIMIT = 4
const DEFAULT_LARGE_CLONE_LIMIT = 6
const DEFAULT_ENTERPRISE_CLONE_LIMIT = 10

async function latestMetric(nodeId: string) {
  return (prisma as any).nodeMetric.findFirst({
    where: { nodeId },
    orderBy: { recordedAt: "desc" },
    select: { cpuUsage: true, ramUsage: true, diskUsage: true, runningVms: true, recordedAt: true },
  }).catch(() => null)
}

export function defaultCloneLimitForNodeClass(input?: { name?: string | null; slug?: string | null } | null) {
  const label = `${input?.name || ""} ${input?.slug || ""}`.toLowerCase()
  if (label.includes("enterprise")) return DEFAULT_ENTERPRISE_CLONE_LIMIT
  if (label.includes("large")) return DEFAULT_LARGE_CLONE_LIMIT
  if (label.includes("medium")) return DEFAULT_MEDIUM_CLONE_LIMIT
  return DEFAULT_SMALL_CLONE_LIMIT
}

export async function calculateNodeWorkerLimit(nodeId: string) {
  const worker = await (prisma as any).nodeWorker.findUnique({ where: { nodeId }, select: { maxTasks: true } }).catch(() => null)
  if (worker?.maxTasks) return Math.max(1, Number(worker.maxTasks || DEFAULT_SMALL_CLONE_LIMIT))

  const node = await prisma.proxmoxNode.findUnique({
    where: { id: nodeId },
    select: { nodeClass: { select: { name: true, slug: true } } },
  }).catch(() => null)
  return defaultCloneLimitForNodeClass(node?.nodeClass)
}

export async function refreshNodeWorker(nodeId: string) {
  const maxTasks = await calculateNodeWorkerLimit(nodeId)
  const metric = await latestMetric(nodeId)
  const load = metric ? Math.max(Number(metric.ramUsage || 0), Number(metric.diskUsage || 0)) : 0
  const health = load >= 85 ? "red" : load >= 70 ? "yellow" : "green"
  return (prisma as any).nodeWorker.upsert({
    where: { nodeId },
    create: { nodeId, maxTasks, health, updatedAt: new Date() },
    update: { maxTasks, health },
  })
}

export async function acquireNodeWorkerSlot(nodeId: string) {
  await refreshNodeWorker(nodeId).catch(() => null)
  const worker = await (prisma as any).nodeWorker.findUnique({ where: { nodeId } }).catch(() => null)
  if (worker && Number(worker.activeTasks || 0) < Number(worker.maxTasks || 1)) {
    const claimed = await (prisma as any).nodeWorker.updateMany({
      where: { nodeId, activeTasks: worker.activeTasks, maxTasks: worker.maxTasks },
      data: {
        activeTasks: { increment: 1 },
        queuedTasks: { decrement: Math.min(1, Number(worker.queuedTasks || 0)) },
        lastTask: new Date(),
      },
    })
    if (Number(claimed?.count || 0) > 0) return true
  }
  await (prisma as any).nodeWorker.upsert({
    where: { nodeId },
    create: { nodeId, activeTasks: 0, maxTasks: 1, queuedTasks: 1, health: "queued" },
    update: { queuedTasks: { increment: 1 }, health: "queued" },
  }).catch(() => null)
  return false
}

export async function releaseNodeWorkerSlot(nodeId?: string | null) {
  if (!nodeId) return
  const worker = await (prisma as any).nodeWorker.findUnique({ where: { nodeId } }).catch(() => null)
  if (!worker || Number(worker.activeTasks || 0) <= 0) return
  await (prisma as any).nodeWorker.updateMany({
    where: { nodeId, activeTasks: worker.activeTasks },
    data: { activeTasks: { decrement: 1 }, lastTask: new Date() },
  }).catch(() => null)
}

export async function recoverNodeWorkerSlots() {
  const stale = new Date(Date.now() - 30 * 60_000)
  await (prisma as any).nodeWorker.updateMany({
    where: { activeTasks: { gt: 0 }, updatedAt: { lt: stale } },
    data: { activeTasks: 0, health: "recovered" },
  }).catch(() => null)
}
