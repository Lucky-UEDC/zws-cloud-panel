import { getClientFromCookies } from "@/lib/server-auth"
import { getClientDeploymentSnapshot } from "@/lib/client-deployments"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return new Response("Unauthorized", { status: 401 })
  const { id } = await params
  const encoder = new TextEncoder()
  let interval: ReturnType<typeof setInterval> | null = null
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`retry: 2000\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      const push = async () => {
        const snapshot = await getClientDeploymentSnapshot({ id, customerId }).catch(() => null)
        if (!snapshot) {
          send("error", { error: "Deployment not found" })
          return
        }
        send("deployment", snapshot)
        const terminal = ["ACTIVE", "FAILED"].includes(String(snapshot.status || "").toUpperCase()) ||
          ["active", "failed", "completed"].includes(String(snapshot.automationState || "").toLowerCase())
        if (terminal) send("heartbeat", { at: new Date().toISOString(), terminal: true })
      }
      await push()
      interval = setInterval(push, 2000)
    },
    cancel() {
      if (interval) clearInterval(interval)
    },
  })
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Connection: "keep-alive",
    },
  })
}
