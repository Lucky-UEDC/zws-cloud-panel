import { NextRequest, NextResponse } from "next/server"
import { getWhatsAppSessionStatus } from "@/lib/whatsapp/status"
import { getWhatsAppAnalytics } from "@/lib/whatsapp/diagnostics"
import { getWhatsAppQueueStats } from "@/lib/whatsapp/queue"
import { jsonError, noStoreHeaders, rateLimitWhatsAppDiagnostics, requireWhatsAppAdmin } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    rateLimitWhatsAppDiagnostics(request)
    const [session, analytics, queues] = await Promise.all([
      getWhatsAppSessionStatus(),
      getWhatsAppAnalytics(),
      getWhatsAppQueueStats(),
    ])
    const workerAgeMs = session.workerHeartbeatAt ? Date.now() - new Date(session.workerHeartbeatAt).getTime() : null
    return NextResponse.json({
      ok: true,
      session,
      analytics,
      queues,
      worker: {
        healthy: session.evolution?.provider === "evolution" ? true : workerAgeMs !== null && workerAgeMs < 90_000,
        heartbeatAgeMs: workerAgeMs,
        mode: "evolution_api",
      },
    }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
