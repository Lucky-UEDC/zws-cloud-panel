import { NextRequest } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { customerStepContentForJob, isNoisyCustomerProvisioningLog, professionalizeProvisioningText, sanitizeCustomerProvisioningMessage } from "@/lib/provisioning-status"
import { realtimeChannels, recentRealtimeEvents, subscribeRealtimeChannel, toRealtimeJson } from "@/lib/realtime-telemetry"
import { clientActivityMessage, clientActivityTitle } from "@/lib/log-format"
import { refreshOneVmRuntimeStatusById } from "@/lib/vm-runtime-status"

export const dynamic = "force-dynamic"
export const revalidate = 0

function percent(used: number, total: number) {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0
  return Math.max(0, Math.min(100, (used / total) * 100))
}

function hasReportedDiskUsage(row: any) {
  const usedBytes = Number(row?.diskUsedBytes || 0)
  const totalBytes = Number(row?.diskTotalBytes || 0)
  if (usedBytes > 0 && totalBytes > 0) return true
  const usage = row?.metadata?.diskUsage
  return Boolean(usage?.ok && Number(usage?.totalBytes || 0) > 0 && Number(usage?.usedBytes || 0) === 0)
}

function serializeMetric(row: any) {
  const ramUsedBytes = Number(row.ramUsedBytes || 0)
  const ramTotalBytes = Number(row.ramTotalBytes || 0)
  const diskReported = hasReportedDiskUsage(row)
  const diskUsedBytes = diskReported ? Number(row.diskUsedBytes || 0) : 0
  const diskTotalBytes = diskReported ? Number(row.diskTotalBytes || 0) : 0
  const recordedAt = row.recordedAt?.toISOString ? row.recordedAt.toISOString() : row.recordedAt || new Date().toISOString()
  return {
    id: row.id,
    recordedAt,
    runtimeStatus: row.runtimeStatus || null,
    cpuPercent: Number(row.cpuPercent || 0),
    ramUsedBytes,
    ramTotalBytes,
    ramPercent: percent(ramUsedBytes, ramTotalBytes),
    diskUsedBytes,
    diskTotalBytes,
    diskFreeBytes: diskReported ? Number(row.diskFreeBytes || 0) : 0,
    diskPercent: percent(diskUsedBytes, diskTotalBytes),
    diskReadBytes: Number(row.diskReadBytes || 0),
    diskWriteBytes: Number(row.diskWriteBytes || 0),
    networkInBytes: Number(row.networkInBytes || 0),
    networkOutBytes: Number(row.networkOutBytes || 0),
  }
}

function cleanLog(log: any, jobType?: string | null) {
  const content = customerStepContentForJob(log.step, jobType)
  return {
    id: `provisioning:${log.id}`,
    createdAt: log.createdAt?.toISOString ? log.createdAt.toISOString() : log.createdAt,
    level: log.level,
    title: content.title,
    message: sanitizeCustomerProvisioningMessage(log.message) || content.message,
  }
}

function panelLog(log: any) {
  const message = clientActivityMessage(professionalizeProvisioningText(String(log.message || "activity recorded").replace(/_/g, " ")))
  return {
    id: `panel:${log.id}`,
    createdAt: (log.timestamp || log.createdAt)?.toISOString ? (log.timestamp || log.createdAt).toISOString() : (log.timestamp || log.createdAt),
    level: log.level || "info",
    title: clientActivityTitle(log.category || log.message),
    message,
  }
}

function safeRealtimeLog(log: any) {
  const message = clientActivityMessage(log?.message || log?.title || "Server activity updated")
  return {
    id: String(log?.id || `activity:${Date.now()}`),
    createdAt: log?.createdAt || new Date().toISOString(),
    level: log?.level || "info",
    title: clientActivityTitle(log?.title || message),
    message,
  }
}

async function resolveVps(id: string, customerId: string) {
  const vps = await prisma.vpsInstance.findFirst({
    where: { OR: [{ id }, { orderId: id }], customerId, deletedAt: null, status: { not: "DELETED" } },
    select: { id: true, orderId: true },
  })
  if (vps) return vps
  const order = await prisma.order.findFirst({
    where: { id, customerId, deletedAt: null, status: { not: "DELETED" } },
    select: { id: true },
  })
  return order ? { id: "", orderId: order.id } : null
}

async function loadMetrics(vpsId: string, since: Date) {
  if (!vpsId) return []
  const rows = await (prisma as any).vpsMetric.findMany({
    where: { vpsInstanceId: vpsId, recordedAt: { gt: since } },
    orderBy: { recordedAt: "asc" },
    take: 120,
  }).catch(() => [])
  return rows.map(serializeMetric)
}

async function loadLogs(input: { vpsId?: string; orderId: string; customerId: string; since: Date }) {
  const [job, panelLogs] = await Promise.all([
    prisma.provisioningJob.findFirst({
      where: { orderId: input.orderId },
      include: { logs: { where: { createdAt: { gt: input.since } }, orderBy: { createdAt: "asc" }, take: 80 } },
      orderBy: { createdAt: "desc" },
    }).catch(() => null),
    prisma.panelLog.findMany({
      where: {
        customerId: input.customerId,
        timestamp: { gt: input.since },
        OR: [
          { orderId: input.orderId },
          ...(input.vpsId ? [{ vpsInstanceId: input.vpsId }] : []),
        ],
      },
      orderBy: { timestamp: "asc" },
      take: 80,
    }).catch(() => []),
  ])
  return [
    ...(job?.logs || []).filter((log) => !isNoisyCustomerProvisioningLog(log.message)).map((log) => cleanLog(log, job?.type)),
    ...panelLogs.filter((log) => !isNoisyCustomerProvisioningLog(log.message)).map(panelLog),
  ].sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return new Response("Unauthorized", { status: 401 })

  const { id } = await params
  const resolved = await resolveVps(id, customerId)
  if (!resolved) return new Response("Instance not found", { status: 404 })

  const encoder = new TextEncoder()
  const metricChannel = resolved.id ? realtimeChannels.vpsMetric(resolved.id) : ""
  const logChannel = resolved.id ? realtimeChannels.vpsLogs(resolved.id) : ""
  let metricSince = new Date(Date.now() - 60 * 60_000)
  let logSince = new Date(Date.now() - 10 * 60_000)
  let interval: ReturnType<typeof setInterval> | null = null
  let unsubscribeMetric: (() => void) | null = null
  let unsubscribeLogs: (() => void) | null = null
  const seenMetricIds = new Set<string>()
  const seenLogIds = new Set<string>()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`retry: 1000\nevent: ${event}\ndata: ${toRealtimeJson(data)}\n\n`))
      }
      const sendMetricRows = (rows: any[]) => {
        const fresh = rows.filter((row) => row?.id && !seenMetricIds.has(row.id))
        for (const row of fresh) seenMetricIds.add(row.id)
        if (!fresh.length) return
        metricSince = new Date(fresh[fresh.length - 1].recordedAt)
        send("metrics", fresh)
      }
      const sendLogRows = (rows: any[]) => {
        const fresh = rows.filter((row) => row?.id && !seenLogIds.has(row.id))
        for (const row of fresh) seenLogIds.add(row.id)
        if (!fresh.length) return
        logSince = new Date(fresh[fresh.length - 1].createdAt)
        send("logs", fresh.map(safeRealtimeLog))
      }

      send("ready", { ok: true, at: new Date().toISOString() })
      if (resolved.id) await refreshOneVmRuntimeStatusById(resolved.id, customerId, { force: true }).catch(() => null)
      if (metricChannel) sendMetricRows(recentRealtimeEvents(metricChannel, 120))
      if (logChannel) sendLogRows(recentRealtimeEvents(logChannel, 80))
      sendMetricRows(await loadMetrics(resolved.id, metricSince).catch(() => []))
      sendLogRows(await loadLogs({ vpsId: resolved.id, orderId: resolved.orderId, customerId, since: logSince }).catch(() => []))

      if (metricChannel) unsubscribeMetric = subscribeRealtimeChannel(metricChannel, (payload) => sendMetricRows(Array.isArray(payload) ? payload : [payload]))
      if (logChannel) unsubscribeLogs = subscribeRealtimeChannel(logChannel, (payload) => sendLogRows(Array.isArray(payload) ? payload : [payload]))

      interval = setInterval(async () => {
        if (resolved.id) await refreshOneVmRuntimeStatusById(resolved.id, customerId, { force: true }).catch(() => null)
        const [metrics, logs] = await Promise.all([
          loadMetrics(resolved.id, metricSince).catch(() => []),
          loadLogs({ vpsId: resolved.id, orderId: resolved.orderId, customerId, since: logSince }).catch(() => []),
        ])
        sendMetricRows(metrics)
        sendLogRows(logs)
        if (!metrics.length && !logs.length) send("heartbeat", { at: new Date().toISOString() })
      }, 30_000)
    },
    cancel() {
      if (interval) clearInterval(interval)
      unsubscribeMetric?.()
      unsubscribeLogs?.()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
