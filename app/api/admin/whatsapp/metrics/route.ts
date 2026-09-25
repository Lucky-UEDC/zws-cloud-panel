import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getWhatsAppAnalytics } from "@/lib/whatsapp/diagnostics"
import { jsonError, noStoreHeaders, rateLimitWhatsAppDiagnostics, requireWhatsAppAdmin } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function hourBucket(date: Date) {
  const next = new Date(date)
  next.setMinutes(0, 0, 0)
  return next.toISOString()
}

export async function GET(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    rateLimitWhatsAppDiagnostics(request)
    const since = new Date(Date.now() - 24 * 60 * 60_000)
    const [analytics, messages, deliveries, retries] = await Promise.all([
      getWhatsAppAnalytics(),
      prisma.whatsAppMessageLog.findMany({
        where: { createdAt: { gte: since } },
        select: { status: true, createdAt: true, sentAt: true, deliveredAt: true, readAt: true },
        orderBy: { createdAt: "asc" },
      }).catch(() => []),
      (prisma as any).whatsAppDeliveryLog.findMany({
        where: { createdAt: { gte: since } },
        select: { status: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }).catch(() => []),
      (prisma as any).whatsAppQueueLog.findMany({
        where: { event: { in: ["job.retrying", "otp.retrying"] }, createdAt: { gte: since } },
        select: { createdAt: true },
      }).catch(() => []),
    ])

    const buckets = new Map<string, any>()
    for (let i = 23; i >= 0; i -= 1) {
      const date = new Date(Date.now() - i * 60 * 60_000)
      buckets.set(hourBucket(date), { hour: hourBucket(date), sent: 0, failures: 0, delivered: 0, read: 0, retries: 0 })
    }
    for (const row of messages) {
      const key = hourBucket(row.createdAt)
      const bucket = buckets.get(key)
      if (!bucket) continue
      if (["sent", "delivered", "read", "played"].includes(row.status)) bucket.sent += 1
      if (["failed", "abandoned"].includes(row.status)) bucket.failures += 1
      if (row.deliveredAt) bucket.delivered += 1
      if (row.readAt) bucket.read += 1
    }
    for (const row of deliveries) {
      const bucket = buckets.get(hourBucket(row.createdAt))
      if (!bucket) continue
      if (row.status === "delivered") bucket.delivered += 1
      if (row.status === "read") bucket.read += 1
    }
    for (const row of retries) {
      const bucket = buckets.get(hourBucket(row.createdAt))
      if (bucket) bucket.retries += 1
    }

    const series = Array.from(buckets.values()).map((bucket) => ({
      ...bucket,
      deliveryRate: bucket.sent ? Math.round((bucket.delivered / bucket.sent) * 100) : 0,
      readRate: bucket.sent ? Math.round((bucket.read / bucket.sent) * 100) : 0,
    }))

    return NextResponse.json({ ok: true, analytics, series }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
