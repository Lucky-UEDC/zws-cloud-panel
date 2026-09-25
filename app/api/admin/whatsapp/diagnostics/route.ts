import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getWhatsAppQueueDiagnostics } from "@/lib/whatsapp/queue"
import { getWhatsAppSessionStatus } from "@/lib/whatsapp/status"
import { jsonError, noStoreHeaders, rateLimitWhatsAppDiagnostics, requireWhatsAppAdmin } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    rateLimitWhatsAppDiagnostics(request, 60)
    const [sessionStatus, queues, sessionLogs, errorLogs, queueLogs, recentOtpFailures, latestAck] = await Promise.all([
      getWhatsAppSessionStatus(),
      getWhatsAppQueueDiagnostics(),
      (prisma as any).whatsAppSessionLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 }).catch(() => []),
      (prisma as any).whatsAppErrorLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 }).catch(() => []),
      (prisma as any).whatsAppQueueLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 }).catch(() => []),
      (prisma as any).whatsAppQueueLog.findMany({
        where: { queueName: { in: ["whatsapp-auth", "whatsapp-otp"] }, status: { in: ["failed", "retrying", "stalled"] } },
        orderBy: { createdAt: "desc" },
        take: 20,
      }).catch(() => []),
      (prisma as any).whatsAppDeliveryLog.findFirst({ orderBy: { createdAt: "desc" } }).catch(() => null),
    ])
    const session = { ...sessionStatus.raw, ...sessionStatus, runtimeStatus: sessionStatus.raw.status, status: sessionStatus.effectiveStatus }
    const connected = session.effectiveStatus === "CONNECTED" && session.sendAvailable === true
    const degraded = {
      degradedMode: !connected || !session.healthy || !queues.queues.some((queue: any) => queue.configured),
      reasons: [
        ...(!connected ? [`WhatsApp session is ${session.effectiveStatus || session.status}`] : []),
        ...(connected && !session.healthy ? [`WhatsApp health is ${session.healthReason || "unknown"}`] : []),
        ...(!session.sendAvailable ? ["Evolution API send path is not available"] : []),
        ...(!session.queueHealthy ? ["WhatsApp queues are not healthy"] : []),
        ...(!queues.queues.some((queue: any) => queue.configured) ? ["Redis queues are not configured"] : []),
        ...(session.workerHeartbeatAt && Date.now() - new Date(session.workerHeartbeatAt).getTime() > 90_000 ? ["WhatsApp worker heartbeat is stale"] : []),
      ],
    }
    const otp = {
      workerOwner: "zws-whatsapp",
      ackTimeoutMs: Number(process.env.WHATSAPP_ACK_TIMEOUT_MS || 90_000),
      minAck: Number(process.env.WHATSAPP_DELIVERY_MIN_ACK || 1),
      recentFailures: recentOtpFailures,
      latestAck,
      health: {
        runtimeReady: session.effectiveStatus === "CONNECTED",
        queueHealthy: Boolean(session.queueHealthy),
        evolutionConfigured: Boolean(session.evolution?.configured),
        evolutionConnected: Boolean(session.evolution?.connected),
      },
    }
    return NextResponse.json({ ok: true, session, queues, otp, degraded, sessionLogs, errorLogs, queueLogs }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
