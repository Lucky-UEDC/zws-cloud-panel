import { canAccessAdminApi } from "@/lib/admin-rbac"
import { prisma } from "@/lib/db"
import { SSE_HEADERS } from "@/lib/http-cache"
import { realtimeChannels, recentRealtimeEvents, subscribeRealtimeChannel, toRealtimeJson } from "@/lib/realtime-telemetry"
import { getAdminFromCookies } from "@/lib/server-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

async function loadInitial() {
  const taskLogDelegate = (prisma as any).provisioningTaskLog
  const [nodes, taskLogs, migrations, ipChanges] = await Promise.all([
    prisma.proxmoxNode.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        nodeName: true,
        status: true,
        updatedAt: true,
        nodeWorker: { select: { activeTasks: true, queuedTasks: true, maxTasks: true, health: true, updatedAt: true } },
      },
      orderBy: { name: "asc" },
    }).catch(() => []),
    taskLogDelegate?.findMany ? taskLogDelegate.findMany({ orderBy: { createdAt: "desc" }, take: 50 }).catch(() => []) : Promise.resolve([]),
    prisma.vmNetworkEvent.findMany({ where: { eventType: { contains: "migration" } }, orderBy: { createdAt: "desc" }, take: 50 }).catch(() => []),
    prisma.vmNetworkEvent.findMany({ where: { eventType: { in: ["change_primary_ip", "switch_pool", "ip.assigned", "ip.secondary_assigned"] } }, orderBy: { createdAt: "desc" }, take: 50 }).catch(() => []),
  ])
  return {
    generatedAt: new Date().toISOString(),
    targetLatencyMs: Number(process.env.PROXMOX_LIVE_SSE_MAX_LATENCY_MS || 250),
    pollMs: Number(process.env.PROXMOX_EVENT_WATCH_MS || 250),
    nodeUsage: nodes,
    taskLogs,
    migrations,
    ipChanges,
  }
}

function withLatency(payload: any) {
  const sourceTime = Date.parse(String(payload?.publishedAt || payload?.createdAt || ""))
  const measuredLagMs = Number.isFinite(sourceTime) ? Math.max(0, Date.now() - sourceTime) : null
  return {
    ...payload,
    measuredLagMs,
    targetLatencyMs: Number(process.env.PROXMOX_LIVE_SSE_MAX_LATENCY_MS || 250),
    streamedAt: new Date().toISOString(),
  }
}

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return new Response("Unauthorized", { status: 401 })
  const encoder = new TextEncoder()
  const channel = realtimeChannels.proxmoxEvents()
  let unsubscribe: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`retry: 1000\nevent: ${event}\ndata: ${toRealtimeJson(data)}\n\n`))
        } catch {
          unsubscribe?.()
          if (heartbeat) clearInterval(heartbeat)
        }
      }
      send("ready", { ok: true, at: new Date().toISOString(), targetLatencyMs: Number(process.env.PROXMOX_LIVE_SSE_MAX_LATENCY_MS || 250) })
      send("initial", await loadInitial().catch((error) => ({ error: error?.message || "Unable to load Proxmox live state" })))
      for (const row of recentRealtimeEvents(channel, 80)) send("proxmox", withLatency(row))
      unsubscribe = subscribeRealtimeChannel(channel, (payload) => send("proxmox", withLatency(payload)))
      heartbeat = setInterval(() => send("heartbeat", { at: new Date().toISOString() }), 15_000)
    },
    cancel() {
      unsubscribe?.()
      if (heartbeat) clearInterval(heartbeat)
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
