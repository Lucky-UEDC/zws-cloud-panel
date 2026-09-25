import { canAccessAdminApi } from "@/lib/admin-rbac"
import { getAdminVmOverview } from "@/lib/admin-vm-query"
import { SSE_HEADERS } from "@/lib/http-cache"
import { realtimeChannels, recentRealtimeEvents, subscribeRealtimeChannel, toRealtimeJson } from "@/lib/realtime-telemetry"
import { getAdminFromCookies } from "@/lib/server-auth"
import { refreshRecentAdminVmRuntimeStatuses } from "@/lib/vm-runtime-status"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

async function loadInitial(request: Request) {
  const url = new URL(request.url)
  await refreshRecentAdminVmRuntimeStatuses(Number(url.searchParams.get("pageSize") || 50)).catch(() => null)
  const payload = await getAdminVmOverview({
    page: Number(url.searchParams.get("page") || 1),
    pageSize: Number(url.searchParams.get("pageSize") || 50),
    includeDeleted: url.searchParams.get("includeDeleted") === "true",
    status: url.searchParams.get("status"),
    search: url.searchParams.get("search"),
    forceRefresh: true,
  })
  return {
    ...payload,
    rows: payload.rows.map((row) => ({ ...row, live: null })),
  }
}

export async function GET(request: Request) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return new Response("Unauthorized", { status: 401 })
  const encoder = new TextEncoder()
  const channel = realtimeChannels.adminVmLive()
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
      unsubscribe = subscribeRealtimeChannel(channel, (payload) => send("vm-live", payload))
      send("ready", { ok: true, at: new Date().toISOString() })
      const initial = await loadInitial(request).catch((error) => ({ success: false, error: error?.message || "Unable to load live VMs", rows: [], pagination: { page: 1, pageSize: 50, total: 0, pages: 1 } }))
      send("initial", initial)
      for (const row of recentRealtimeEvents(channel, 40)) send("vm-live", row)
      heartbeat = setInterval(() => send("heartbeat", { at: new Date().toISOString() }), 15_000)
    },
    cancel() {
      unsubscribe?.()
      if (heartbeat) clearInterval(heartbeat)
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
