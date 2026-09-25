import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { getRuntimeConfig } from "@/lib/runtime-config"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  const encoder = new TextEncoder()
  let interval: ReturnType<typeof setInterval> | null = null
  let lastVersion = 0

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`retry: 3000\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      const publish = async (event: string) => {
        const config = await getRuntimeConfig()
        lastVersion = Number(config.version || 0)
        send(event, { version: config.version, updatedAt: config.updatedAt, analytics: config.analytics })
      }
      await publish("runtime-config")
      interval = setInterval(async () => {
        const config = await getRuntimeConfig().catch(() => null)
        const version = Number(config?.version || 0)
        if (config && version !== lastVersion) {
          lastVersion = version
          send("runtime-config", { version: config.version, updatedAt: config.updatedAt, analytics: config.analytics })
        } else {
          send("heartbeat", { at: new Date().toISOString(), version: lastVersion })
        }
      }, 5000)
    },
    cancel() {
      if (interval) clearInterval(interval)
    },
  })

  return new Response(stream, {
    headers: {
      ...NO_CACHE_HEADERS,
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
