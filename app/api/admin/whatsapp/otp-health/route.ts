import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { cleanupStalePhoneVerifications } from "@/lib/auth/phone-verification"
import { getWhatsAppQueueDiagnostics } from "@/lib/whatsapp/queue"
import { getWhatsAppSessionStatus } from "@/lib/whatsapp/status"
import { jsonError, noStoreHeaders, rateLimitWhatsAppDiagnostics, requireWhatsAppAdmin } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    rateLimitWhatsAppDiagnostics(request, 60)
    await cleanupStalePhoneVerifications().catch(() => null)
    const since = new Date(Date.now() - 24 * 60 * 60_000)
    const [session, queues, deliveryCounts, recentVerifications, recentQueueLogs, recentFailures] = await Promise.all([
      getWhatsAppSessionStatus(),
      getWhatsAppQueueDiagnostics(),
      (prisma as any).phoneVerification.groupBy({
        by: ["deliveryStatus"],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }).catch(() => []),
      (prisma as any).phoneVerification.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          phone: true,
          deliveryStatus: true,
          otpCorrelationId: true,
          whatsappMessageId: true,
          attempts: true,
          expiresAt: true,
          verifiedAt: true,
          consumedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }).catch(() => []),
      (prisma as any).whatsAppQueueLog.findMany({
        where: { queueName: { in: ["whatsapp-auth", "whatsapp-otp"] } },
        orderBy: { createdAt: "desc" },
        take: 50,
      }).catch(() => []),
      (prisma as any).whatsAppErrorLog.findMany({
        where: { OR: [{ queueName: { in: ["whatsapp-auth", "whatsapp-otp"] } }, { queueName: null }] },
        orderBy: { createdAt: "desc" },
        take: 20,
      }).catch(() => []),
    ])

    const counts = Object.fromEntries(deliveryCounts.map((row: any) => [row.deliveryStatus || "unknown", Number(row._count?._all || 0)]))
    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      windowHours: 24,
      runtime: {
        effectiveStatus: session.effectiveStatus,
        sendAvailable: session.sendAvailable,
        queueHealthy: session.queueHealthy,
        workerHeartbeatFresh: session.workerHeartbeatFresh,
        healthReason: session.healthReason,
        provider: "evolution",
      },
      queues: queues.queues.filter((queue: any) => ["whatsapp-auth", "whatsapp-otp", "whatsapp-send"].includes(queue.name)),
      deliveryCounts: counts,
      recentVerifications: recentVerifications.map((row: any) => ({
        ...row,
        phone: row.phone ? row.phone.replace(/\d(?=\d{2})/g, "*") : null,
        expiresAt: row.expiresAt?.toISOString ? row.expiresAt.toISOString() : row.expiresAt,
        verifiedAt: row.verifiedAt?.toISOString ? row.verifiedAt.toISOString() : row.verifiedAt,
        consumedAt: row.consumedAt?.toISOString ? row.consumedAt.toISOString() : row.consumedAt,
        createdAt: row.createdAt?.toISOString ? row.createdAt.toISOString() : row.createdAt,
        updatedAt: row.updatedAt?.toISOString ? row.updatedAt.toISOString() : row.updatedAt,
      })),
      recentQueueLogs,
      recentFailures,
    }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
