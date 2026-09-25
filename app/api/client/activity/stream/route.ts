import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { clientActivityCategory, clientActivityMessage, clientActivityTitle, normalizeLogSeverity } from "@/lib/log-format"

export const dynamic = "force-dynamic"
export const revalidate = 0

function serialize(row: any) {
  const message = clientActivityMessage(row.reason || row.eventType)
  return {
    id: row.id,
    timestamp: row.timestamp,
    severity: normalizeLogSeverity(row.severity),
    category: clientActivityCategory(row.eventType),
    title: clientActivityTitle(message),
    message,
    status: row.status,
    orderId: row.orderId,
    vpsInstanceId: row.vpsInstanceId || row.vmId,
  }
}

export async function GET() {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return new Response("Unauthorized", { status: 401 })
  const encoder = new TextEncoder()
  let lastSeen = new Date()
  let interval: ReturnType<typeof setInterval> | null = null
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`retry: 2000\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      send("ready", { ok: true })
      interval = setInterval(async () => {
        const rows = await (prisma as any).auditEvent.findMany({
          where: { customerId, timestamp: { gt: lastSeen } },
          orderBy: { timestamp: "asc" },
          take: 25,
        }).catch(() => [])
        if (rows.length) {
          lastSeen = rows[rows.length - 1].timestamp || new Date()
          send("events", rows.map(serialize))
        } else {
          send("heartbeat", { at: new Date().toISOString() })
        }
      }, 1500)
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
