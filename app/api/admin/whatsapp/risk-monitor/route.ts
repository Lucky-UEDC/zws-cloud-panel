import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getWhatsAppQueueStats } from "@/lib/whatsapp/queue"
import { jsonError, noStoreHeaders, rateLimitWhatsAppDiagnostics, requireWhatsAppAdmin } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    rateLimitWhatsAppDiagnostics(request)
    const since = new Date(Date.now() - 24 * 60 * 60_000)
    const [queues, failures, suppressions, campaigns, riskRules] = await Promise.all([
      getWhatsAppQueueStats(),
      (prisma as any).whatsAppMessageLog.count({ where: { status: { in: ["failed", "abandoned", "retrying"] }, createdAt: { gte: since } } }).catch(() => 0),
      (prisma as any).whatsAppSuppression.count({ where: { active: true } }).catch(() => 0),
      (prisma as any).whatsAppCampaign.findMany({ orderBy: { createdAt: "desc" }, take: 20 }).catch(() => []),
      (prisma as any).whatsAppRiskRule.findMany({ orderBy: { createdAt: "desc" }, take: 50 }).catch(() => []),
    ])
    const highRisk = campaigns.filter((campaign: any) => Number(campaign.riskScore || 0) >= 50 || Number(campaign.qualityScore || 100) < 75)
    return NextResponse.json({
      ok: true,
      queues,
      failures24h: failures,
      activeSuppressions: suppressions,
      highRisk,
      riskRules,
    }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
