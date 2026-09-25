import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getWhatsAppAnalytics } from "@/lib/whatsapp/diagnostics"
import { getWhatsAppQueueStats } from "@/lib/whatsapp/queue"
import { rateLimitWhatsAppDiagnostics, requireWhatsAppAdmin } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    rateLimitWhatsAppDiagnostics(request, 30)
  } catch {
    return new Response("Unauthorized", { status: 401 })
  }

  const encoder = new TextEncoder()
  let lastSeen = new Date()
  let interval: ReturnType<typeof setInterval> | null = null
  let closed = false
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`retry: 2000\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
          if (interval) clearInterval(interval)
        }
      }
      send("ready", { ok: true, at: lastSeen.toISOString() })
      interval = setInterval(async () => {
        try {
          const { getWhatsAppSessionStatus } = await import("@/lib/whatsapp/status")
          const [logs, sessionLogs, queueLogs, deliveryLogs, errorLogs, session, analytics, queues] = await Promise.all([
            (prisma as any).whatsAppLog.findMany({
              where: { createdAt: { gt: lastSeen } },
              orderBy: { createdAt: "asc" },
              take: 50,
            }).catch(() => []),
            (prisma as any).whatsAppSessionLog.findMany({
              where: { createdAt: { gt: lastSeen } },
              orderBy: { createdAt: "asc" },
              take: 50,
            }).catch(() => []),
            (prisma as any).whatsAppQueueLog.findMany({
              where: { createdAt: { gt: lastSeen } },
              orderBy: { createdAt: "asc" },
              take: 50,
            }).catch(() => []),
            (prisma as any).whatsAppDeliveryLog.findMany({
              where: { createdAt: { gt: lastSeen } },
              orderBy: { createdAt: "asc" },
              take: 50,
            }).catch(() => []),
            (prisma as any).whatsAppErrorLog.findMany({
              where: { createdAt: { gt: lastSeen } },
              orderBy: { createdAt: "asc" },
              take: 50,
            }).catch(() => []),
            getWhatsAppSessionStatus(),
            getWhatsAppAnalytics(),
            getWhatsAppQueueStats(),
          ])
          const allEvents = [...logs, ...sessionLogs, ...queueLogs, ...deliveryLogs, ...errorLogs]
            .filter((entry) => entry?.createdAt)
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
          if (allEvents.length) lastSeen = allEvents[allEvents.length - 1].createdAt || new Date()
          send("snapshot", { logs, sessionLogs, queueLogs, deliveryLogs, errorLogs, session: { ...session.raw, ...session, runtimeStatus: session.raw.status, status: session.effectiveStatus }, analytics, queues, at: new Date().toISOString() })
        } catch {
          send("heartbeat", { at: new Date().toISOString() })
        }
      }, 4000)
    },
    cancel() {
      closed = true
      if (interval) clearInterval(interval)
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      Connection: "keep-alive",
    },
  })
}
