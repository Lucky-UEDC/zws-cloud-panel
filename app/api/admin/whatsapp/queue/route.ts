import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getWhatsAppAnalytics } from "@/lib/whatsapp/diagnostics"
import { getWhatsAppQueueStats } from "@/lib/whatsapp/queue"
import { jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    await requireWhatsAppAdmin(request)
    const [queues, analytics, activeCampaigns, recentLogs] = await Promise.all([
      getWhatsAppQueueStats(),
      getWhatsAppAnalytics(),
      prisma.whatsAppCampaign.count({ where: { status: { in: ["queued", "scheduled", "running", "paused"] } } }),
      prisma.whatsAppMessageLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
    ])
    return NextResponse.json({ ok: true, queues, ...analytics, activeCampaigns, recentLogs }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
