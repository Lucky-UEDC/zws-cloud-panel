import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { latestNodeMetric } from "@/lib/node-telemetry"
import { realtimeChannels, recentRealtimeEvents, subscribeRealtimeChannel, toRealtimeJson } from "@/lib/realtime-telemetry"

export const dynamic = "force-dynamic"
export const revalidate = 0

const metricNumberFields = [
  "cpuUsage",
  "ramUsage",
  "diskUsage",
  "networkIn",
  "networkOut",
  "load1",
  "load5",
  "load15",
  "uptime",
  "runningVms",
  "stoppedVms",
]

function normalizeMetricEvent(metric: any) {
  if (!metric || typeof metric !== "object") return null
  if (!metric.recordedAt) return null
  for (const field of metricNumberFields) {
    const value = Number(metric[field])
    if (!Number.isFinite(value)) return null
    metric[field] = value
  }
  return metric
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return new Response("Unauthorized", { status: 401 })
  const { id } = await params
  const encoder = new TextEncoder()
  let interval: ReturnType<typeof setInterval> | null = null
  let unsubscribe: (() => void) | null = null
  const channel = realtimeChannels.nodeMetric(id)

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`retry: 1000\nevent: ${event}\ndata: ${toRealtimeJson(data)}\n\n`))
      }
      const sendMetric = (metric: unknown) => {
        const normalized = normalizeMetricEvent(metric)
        if (normalized) send("metric", normalized)
      }
      send("ready", { ok: true, at: new Date().toISOString() })
      for (const metric of recentRealtimeEvents(channel, 5)) sendMetric(metric)
      const initial = await latestNodeMetric(id).catch(() => null)
      sendMetric(initial)

      unsubscribe = subscribeRealtimeChannel(channel, sendMetric)
      interval = setInterval(async () => {
        const metric = await latestNodeMetric(id).catch(() => null)
        const normalized = normalizeMetricEvent(metric)
        if (normalized) send("metric", normalized)
        else send("heartbeat", { at: new Date().toISOString() })
      }, 30_000)
    },
    cancel() {
      if (interval) clearInterval(interval)
      unsubscribe?.()
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
