import { canAccessAdminApi } from "@/lib/admin-rbac"
import { SSE_HEADERS } from "@/lib/http-cache"
import { realtimeChannels, recentRealtimeEvents, subscribeRealtimeChannel, toRealtimeJson } from "@/lib/realtime-telemetry"
import { getAdminFromCookies } from "@/lib/server-auth"
import { loadCachedVmSnapshot } from "@/lib/vm-cache-snapshot"
import { refreshOneVmRuntimeStatusById } from "@/lib/vm-runtime-status"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return new Response("Unauthorized", { status: 401 })
  const { id } = await params
  const encoder = new TextEncoder()
  const channel = realtimeChannels.vpsLive(id)
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
      for (const row of recentRealtimeEvents(channel, 10)) send("vm-live", row)
      await refreshOneVmRuntimeStatusById(id, null, { force: true }).catch(() => null)
      const snapshot = await loadCachedVmSnapshot(id).catch((error) => ({ error: error?.message || "Unable to load cached VM data", vpsInstanceId: id }))
      send("vm-live", { reason: "initial", snapshot })
      heartbeat = setInterval(async () => {
        await refreshOneVmRuntimeStatusById(id, null, { force: true }).catch(() => null)
        const snapshot = await loadCachedVmSnapshot(id).catch(() => null)
        send(snapshot ? "vm-live" : "heartbeat", snapshot ? { reason: "poll", snapshot } : { at: new Date().toISOString() })
      }, 30_000)
    },
    cancel() {
      unsubscribe?.()
      if (heartbeat) clearInterval(heartbeat)
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
