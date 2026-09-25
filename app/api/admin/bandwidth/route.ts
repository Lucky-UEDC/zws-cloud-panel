import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { bucketStart, getBandwidthSummary, type BandwidthPeriod, type BandwidthScopeType } from "@/lib/bandwidth-accounting"
import { getBandwidthThrottleSummary } from "@/lib/bandwidth-enforcement"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PERIODS = new Set(["minute", "hour", "day", "week", "month", "year", "lifetime"])
const SCOPES = new Set(["vps", "customer", "node", "product", "ip"])

function numberValue(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function csv(summary: any) {
  const rows = [
    ["bucketAt", "rxBytes", "txBytes", "totalBytes", "peakRateBps", "estimatedInr", "discountPercent"],
    ...summary.rows.map((row: any) => [
      row.bucketAt,
      row.rxBytes,
      row.txBytes,
      row.totalBytes,
      row.peakRateBps,
      row.estimatedInr,
      row.discountPercent,
    ]),
  ]
  return rows.map((row) => row.map((cell: unknown) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")
}

async function pdf(summary: any) {
  const PDFDocument = (await import("pdfkit")).default
  const doc = new PDFDocument({ margin: 40, size: "A4" })
  const chunks: Buffer[] = []
  doc.on("data", (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))))
  doc.fontSize(18).text("Bandwidth Usage Report")
  doc.moveDown()
  doc.fontSize(10)
  doc.text(`Period: ${summary.period}`)
  doc.text(`Range: ${summary.from} to ${summary.to}`)
  doc.text(`Total transfer: ${summary.totalBytes} bytes`)
  doc.text(`RX: ${summary.rxBytes} bytes`)
  doc.text(`TX: ${summary.txBytes} bytes`)
  doc.text(`Peak rate: ${summary.peakRateBps} B/s`)
  doc.text(`Estimated overage: INR ${summary.estimatedInr}`)
  doc.text(`Discount: ${summary.discountPercent}%`)
  doc.moveDown()
  doc.text("Recent buckets")
  for (const row of summary.rows.slice(-30)) {
    doc.text(`${row.bucketAt}  RX ${row.rxBytes}  TX ${row.txBytes}  Total ${row.totalBytes}  Peak ${row.peakRateBps} B/s`)
  }
  doc.end()
  return done
}

export async function GET(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const params = request.nextUrl.searchParams
  const scopeType = String(params.get("scopeType") || "vps")
  const scopeId = String(params.get("scopeId") || "")
  const period = String(params.get("period") || "month")
  const format = String(params.get("format") || "json")
  if (!SCOPES.has(scopeType) || !PERIODS.has(period)) {
    return NextResponse.json({ success: false, error: "Invalid bandwidth query." }, { status: 400 })
  }

  if (!scopeId) {
    const monthBucket = bucketStart("month")
    const dayBucket = bucketStart("day")
    const [vpsRows, nodeRows, dayTotals, monthTotals, alerts, throttleRows, latestSamples, activeVmCounts] = await Promise.all([
      (prisma as any).bandwidthUsageRollup.findMany({
        where: { period: "month", scopeType: "vps", bucketAt: monthBucket },
        orderBy: { totalBytes: "desc" },
        take: 100,
        include: {
          vpsInstance: {
            select: {
              id: true,
              name: true,
              ipAddress: true,
              vmid: true,
              customer: { select: { id: true, email: true, name: true } },
              product: { select: { id: true, name: true, bandwidthTb: true } },
              proxmoxNode: { select: { id: true, name: true, nodeName: true } },
            },
          },
        },
      }).catch(() => []),
      (prisma as any).bandwidthUsageRollup.findMany({
        where: { period: "month", scopeType: "node", bucketAt: monthBucket },
        orderBy: { totalBytes: "desc" },
        take: 100,
      }).catch(() => []),
      (prisma as any).bandwidthUsageRollup.aggregate({
        where: { period: "day", scopeType: "vps", bucketAt: dayBucket },
        _sum: { rxBytes: true, txBytes: true, totalBytes: true },
        _max: { peakRateBps: true },
      }).catch(() => null),
      (prisma as any).bandwidthUsageRollup.aggregate({
        where: { period: "month", scopeType: "vps", bucketAt: monthBucket },
        _sum: { rxBytes: true, txBytes: true, totalBytes: true, estimatedInr: true },
        _max: { peakRateBps: true },
      }).catch(() => null),
      (prisma as any).bandwidthUsageAlert.findMany({
        where: { status: "open" },
        orderBy: { lastSeenAt: "desc" },
        take: 50,
      }).catch(() => []),
      (prisma as any).bandwidthThrottleState.findMany({ where: { status: "throttled" } }).catch(() => []),
      (prisma as any).bandwidthUsageSample.findMany({
        orderBy: { recordedAt: "desc" },
        take: 500,
        select: { vpsInstanceId: true, rxRateBps: true, txRateBps: true, peakRateBps: true, recordedAt: true },
      }).catch(() => []),
      prisma.vpsInstance.groupBy({
        by: ["proxmoxNodeId"],
        where: { deletedAt: null, proxmoxNodeId: { not: null }, status: { in: ["ACTIVE", "RUNNING", "STARTING_VM", "REBOOTING"] } },
        _count: { _all: true },
      }).catch(() => []),
    ])
    const latestByVps = new Map()
    for (const sample of latestSamples as any[]) {
      if (!latestByVps.has(sample.vpsInstanceId)) latestByVps.set(sample.vpsInstanceId, sample)
    }
    const throttleByVps = new Map(throttleRows.map((row: any) => [row.vpsInstanceId, row]))
    const activeByNode = new Map(activeVmCounts.map((row: any) => [row.proxmoxNodeId, row._count?._all || 0]))
    const vms = vpsRows.map((row: any) => {
      const latest = latestByVps.get(row.vpsInstanceId) as any
      const throttle = throttleByVps.get(row.vpsInstanceId) as any
      const includedBytes = Number(row.includedBytes || 0)
      const remainingBytes = Math.max(0, includedBytes - Number(row.totalBytes || 0))
      return {
        vpsInstanceId: row.vpsInstanceId,
        customerId: row.customerId,
        customerName: row.vpsInstance?.customer?.name || "Customer",
        customerEmail: row.vpsInstance?.customer?.email || null,
        vmName: row.vpsInstance?.name || row.vpsInstanceId,
        vmid: row.vpsInstance?.vmid || row.vmid || null,
        ipAddress: row.vpsInstance?.ipAddress || row.ipAddress || null,
        nodeId: row.proxmoxNodeId || row.vpsInstance?.proxmoxNode?.id || null,
        nodeName: row.vpsInstance?.proxmoxNode?.name || row.vpsInstance?.proxmoxNode?.nodeName || row.proxmoxNodeId || "-",
        productName: row.vpsInstance?.product?.name || null,
        bandwidthLimitTb: numberValue(row.vpsInstance?.product?.bandwidthTb),
        includedBytes,
        remainingBytes,
        rxBytes: Number(row.rxBytes || 0),
        txBytes: Number(row.txBytes || 0),
        totalBytes: Number(row.totalBytes || 0),
        rxRateBps: Number(latest?.rxRateBps || 0),
        txRateBps: Number(latest?.txRateBps || 0),
        peakRateBps: Number(row.peakRateBps || latest?.peakRateBps || 0),
        currentKbps: Number((((Number(latest?.rxRateBps || 0) + Number(latest?.txRateBps || 0)) * 8) / 1000).toFixed(1)),
        currentMbps: Number((((Number(latest?.rxRateBps || 0) + Number(latest?.txRateBps || 0)) * 8) / 1_000_000).toFixed(3)),
        throttled: Boolean(throttle),
        currentRateLimit: throttle?.proxmoxRateValue == null ? null : Number(throttle.proxmoxRateValue),
        throttleRateMbps: throttle?.throttleRateMbps == null ? null : Number(throttle.throttleRateMbps),
        cycleEndsAt: throttle?.cycleEndsAt?.toISOString ? throttle.cycleEndsAt.toISOString() : throttle?.cycleEndsAt || null,
        overLimit: includedBytes > 0 && Number(row.totalBytes || 0) > includedBytes,
      }
    })
    const nodes = nodeRows.map((row: any) => {
      const nodeVms = vms.filter((vm: any) => vm.nodeId === row.scopeId || vm.nodeId === row.proxmoxNodeId)
      const activeVmCount = Number(activeByNode.get(row.scopeId) || activeByNode.get(row.proxmoxNodeId) || nodeVms.length)
      return {
        nodeId: row.scopeId,
        nodeName: nodeVms[0]?.nodeName || row.scopeId,
        rxBytes: Number(row.rxBytes || 0),
        txBytes: Number(row.txBytes || 0),
        totalBytes: Number(row.totalBytes || 0),
        peakRateBps: Number(row.peakRateBps || 0),
        rxRateBps: nodeVms.reduce((sum: number, vm: any) => sum + Number(vm.rxRateBps || 0), 0),
        txRateBps: nodeVms.reduce((sum: number, vm: any) => sum + Number(vm.txRateBps || 0), 0),
        activeMbps: Number(((nodeVms.reduce((sum: number, vm: any) => sum + Number(vm.rxRateBps || 0) + Number(vm.txRateBps || 0), 0) * 8) / 1_000_000).toFixed(3)),
        activeVmCount,
        throttledVmCount: nodeVms.filter((vm: any) => vm.throttled).length,
      }
    })
    const top = vms.slice(0, 25)
    return NextResponse.json({
      success: true,
      top,
      vms,
      nodes,
      global: {
        monthBucketAt: monthBucket.toISOString(),
        dayBucketAt: dayBucket.toISOString(),
        monthlyTransferBytes: Number(monthTotals?._sum?.totalBytes || 0),
        monthlyRxBytes: Number(monthTotals?._sum?.rxBytes || 0),
        monthlyTxBytes: Number(monthTotals?._sum?.txBytes || 0),
        dailyTransferBytes: Number(dayTotals?._sum?.totalBytes || 0),
        platformTrafficBytes: Number(monthTotals?._sum?.totalBytes || 0),
        peakRateBps: Number(monthTotals?._max?.peakRateBps || dayTotals?._max?.peakRateBps || 0),
        estimatedInr: Number(monthTotals?._sum?.estimatedInr || 0),
        overLimitUsers: vms.filter((vm: any) => vm.overLimit).length,
        throttledVms: vms.filter((vm: any) => vm.throttled).length,
        openAlerts: alerts.length,
      },
      alerts: alerts.map((alert: any) => ({
        id: alert.id,
        vpsInstanceId: alert.vpsInstanceId,
        customerId: alert.customerId,
        alertType: alert.alertType,
        currentBytes: Number(alert.currentBytes || 0),
        thresholdBytes: Number(alert.thresholdBytes || 0),
        message: alert.message,
        lastSeenAt: alert.lastSeenAt?.toISOString ? alert.lastSeenAt.toISOString() : alert.lastSeenAt,
      })),
    }, { headers: { "Cache-Control": "no-store" } })
  }

  const vps = scopeType === "vps"
    ? await prisma.vpsInstance.findUnique({ where: { id: scopeId }, include: { product: { select: { bandwidthTb: true } } } }).catch(() => null)
    : null
  const summary = await getBandwidthSummary({
    scopeType: scopeType as BandwidthScopeType,
    scopeId,
    period: period as BandwidthPeriod,
    includedBandwidthTb: vps?.product?.bandwidthTb || 0,
  })
  const [latestSample, throttle] = scopeType === "vps"
    ? await Promise.all([
        (prisma as any).bandwidthUsageSample.findFirst({
          where: { vpsInstanceId: scopeId },
          orderBy: { recordedAt: "desc" },
          select: { rxRateBps: true, txRateBps: true, recordedAt: true },
        }).catch(() => null),
        getBandwidthThrottleSummary(scopeId).catch(() => null),
      ])
    : [null, null]
  const enrichedSummary = {
    ...summary,
    rxRateBps: Number(latestSample?.rxRateBps || 0),
    txRateBps: Number(latestSample?.txRateBps || 0),
    latestRateAt: latestSample?.recordedAt?.toISOString ? latestSample.recordedAt.toISOString() : latestSample?.recordedAt || null,
    monthlyTotalBytes: throttle?.monthlyTotalBytes ?? summary.totalBytes,
    includedBytes: throttle?.includedBytes ?? summary.includedBytes,
    overLimit: Boolean(throttle?.overLimit),
    throttled: Boolean(throttle?.throttled),
    currentRateLimit: throttle?.currentRateLimit ?? null,
    throttleRateMbps: throttle?.throttleRateMbps ?? null,
    cycleEndsAt: throttle?.cycleEndsAt ?? null,
  }

  if (format === "csv") {
    return new Response(csv(enrichedSummary), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="bandwidth-${scopeType}-${scopeId}-${period}.csv"`,
        "Cache-Control": "no-store",
      },
    })
  }
  if (format === "pdf") {
    const body = await pdf(enrichedSummary)
    return new Response(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="bandwidth-${scopeType}-${scopeId}-${period}.pdf"`,
        "Cache-Control": "no-store",
      },
    })
  }

  return NextResponse.json({ success: true, summary: enrichedSummary }, { headers: { "Cache-Control": "no-store" } })
}
