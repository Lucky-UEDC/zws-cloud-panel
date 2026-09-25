import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getClientFromCookies } from "@/lib/server-auth"
import { getBandwidthSummary, type BandwidthPeriod } from "@/lib/bandwidth-accounting"
import { getBandwidthThrottleSummary } from "@/lib/bandwidth-enforcement"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PERIODS = new Set(["minute", "hour", "day", "week", "month", "year", "lifetime"])

function freshness(recordedAt?: string | Date | null) {
  const at = recordedAt ? new Date(recordedAt).getTime() : 0
  const ageMs = at ? Date.now() - at : Number.POSITIVE_INFINITY
  const state = ageMs <= 35_000 ? "LIVE" : ageMs <= 120_000 ? "STALE" : "UNAVAILABLE"
  return {
    state,
    source: state === "LIVE" ? "live" : state === "STALE" ? "cached" : "unavailable",
    lastUpdatedAt: recordedAt instanceof Date ? recordedAt.toISOString() : recordedAt || null,
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const period = String(request.nextUrl.searchParams.get("period") || "month")
  if (!PERIODS.has(period)) return NextResponse.json({ success: false, error: "Invalid period." }, { status: 400 })

  const vps = await prisma.vpsInstance.findFirst({
    where: { OR: [{ id }, { orderId: id }], customerId, deletedAt: null, status: { not: "DELETED" } },
    include: { product: { select: { bandwidthTb: true } } },
  })
  if (!vps) return NextResponse.json({ success: false, error: "Instance not found" }, { status: 404 })

  const summary = await getBandwidthSummary({
    scopeType: "vps",
    scopeId: vps.id,
    period: period as BandwidthPeriod,
    includedBandwidthTb: vps.product?.bandwidthTb || 0,
  })
  const [latestSample, throttle] = await Promise.all([
    (prisma as any).bandwidthUsageSample.findFirst({
      where: { vpsInstanceId: vps.id },
      orderBy: { recordedAt: "desc" },
      select: { rxRateBps: true, txRateBps: true, recordedAt: true },
    }).catch(() => null),
    getBandwidthThrottleSummary(vps.id).catch(() => null),
  ])
  const alerts = await (prisma as any).bandwidthUsageAlert.findMany({
    where: { vpsInstanceId: vps.id, status: "open" },
    orderBy: { lastSeenAt: "desc" },
    take: 10,
  }).catch(() => [])

  return NextResponse.json({
    success: true,
    summary: {
      ...summary,
      rxRateBps: Number(latestSample?.rxRateBps || 0),
      txRateBps: Number(latestSample?.txRateBps || 0),
      latestRateAt: latestSample?.recordedAt?.toISOString ? latestSample.recordedAt.toISOString() : latestSample?.recordedAt || null,
      freshness: freshness(latestSample?.recordedAt || null),
      monthlyTotalBytes: throttle?.monthlyTotalBytes ?? summary.totalBytes,
      includedBytes: throttle?.includedBytes ?? summary.includedBytes,
      overLimit: Boolean(throttle?.overLimit),
      throttled: Boolean(throttle?.throttled),
      currentRateLimit: throttle?.currentRateLimit ?? null,
      throttleRateMbps: throttle?.throttleRateMbps ?? null,
      cycleEndsAt: throttle?.cycleEndsAt ?? null,
    },
    alerts: alerts.map((alert: any) => ({
      id: alert.id,
      alertType: alert.alertType,
      message: alert.message,
      thresholdBytes: Number(alert.thresholdBytes || 0),
      currentBytes: Number(alert.currentBytes || 0),
      firstSeenAt: alert.firstSeenAt?.toISOString ? alert.firstSeenAt.toISOString() : alert.firstSeenAt,
      lastSeenAt: alert.lastSeenAt?.toISOString ? alert.lastSeenAt.toISOString() : alert.lastSeenAt,
    })),
  }, { headers: { "Cache-Control": "no-store" } })
}
