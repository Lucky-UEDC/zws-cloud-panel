import { canAccessAdminApi } from "@/lib/admin-rbac"
import { loadAdminBandwidthDashboard } from "@/lib/admin-bandwidth-dashboard"
import { realtimeChannels, recentRealtimeEvents, subscribeRealtimeChannel, toRealtimeJson } from "@/lib/realtime-telemetry"
import { getAdminFromCookies } from "@/lib/server-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return new Response("Unauthorized", { status: 401 })

  const encoder = new TextEncoder()
  const channel = realtimeChannels.adminBandwidthLive()
  let interval: ReturnType<typeof setInterval> | null = null
  let unsubscribe: (() => void) | null = null

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`retry: 1000\nevent: ${event}\ndata: ${toRealtimeJson(data)}\n\n`))
        } catch {
          unsubscribe?.()
          if (interval) clearInterval(interval)
        }
      }

      send("ready", { ok: true, at: new Date().toISOString(), pollMs: Number(process.env.LIVE_BANDWIDTH_POLL_MS || 1000) })
      const initial = await loadAdminBandwidthDashboard().catch((error) => ({
        success: false,
        error: error?.message || "Unable to load initial live bandwidth snapshot.",
        generatedAt: new Date().toISOString(),
        vms: [],
        nodes: [],
        alerts: [],
        global: {},
      }))
      send("initial", initial)
      for (const event of recentRealtimeEvents(channel, 3)) send("live", event)

      unsubscribe = subscribeRealtimeChannel(channel, (payload) => send("live", payload))
      interval = setInterval(() => send("heartbeat", { at: new Date().toISOString() }), 15_000)
    },
    cancel() {
      unsubscribe?.()
      if (interval) clearInterval(interval)
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
