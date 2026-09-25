import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManageSettings } from "@/lib/admin-rbac"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

function n(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

const BILLABLE_KINDS = ["backup_plan", "backup_plan_renewal", "backup_storage_upgrade", "snapshot_charge"]

export async function GET(request: NextRequest) {
  const admin = await getAdminFromCookies().catch(() => null)
  if (!admin?.email || !canManageSettings(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const [orders, subscriptions, upgrades, overageRows, walletRows, refundRows, snapshotCharges] = await Promise.all([
    prisma.order.findMany({
      where: { status: { in: ["paid", "completed"] } },
      select: { finalAmount: true, subtotal: true, taxAmount: true, metadata: true, createdAt: true, currency: true },
    }).catch(() => []),
    prisma.backupSubscription.findMany({
      include: { plan: { select: { name: true } } },
    }).catch(() => []),
    prisma.backupStorageUpgrade.findMany({ where: { status: "active" }, select: { gb: true, pricePerGb: true } }).catch(() => []),
    prisma.backupOverage.findMany({ where: { status: "unbilled" }, select: { overageGb: true, ratePerGb: true, amount: true } }).catch(() => []),
    prisma.walletTransaction.findMany({
      where: { type: { in: ["topup", "CREDIT_TOPUP"] }, status: { in: ["completed", "success"] } },
      select: { amount: true, gatewayFee: true, type: true, gateway: true },
    }).catch(() => []),
    prisma.walletTransaction.findMany({
      where: { type: "refund", status: "completed" },
      select: { amount: true, reason: true, referenceId: true, createdAt: true },
    }).catch(() => []),
    prisma.snapshotCharge.findMany({
      select: { status: true, totalAmount: true },
    }).catch(() => []),
  ])

  const revenueByKind: Record<string, number> = {}
  let totalPaid = 0
  let totalTax = 0
  let billableCount = 0
  for (const order of orders as any[]) {
    const kind = String(record(order.metadata).kind || "").trim().toLowerCase()
    if (!BILLABLE_KINDS.includes(kind)) continue
    billableCount += 1
    revenueByKind[kind] = n(revenueByKind[kind]) + n(order.finalAmount || order.totalAmount || 0)
    totalPaid += n(order.finalAmount || order.totalAmount || 0)
    totalTax += n(order.taxAmount || 0)
  }

  const byStatus: Record<string, number> = {}
  for (const sub of subscriptions as any[]) {
    byStatus[sub.status] = (byStatus[sub.status] || 0) + 1
  }

  const now = new Date()
  const upcomingExpiry = {
    next7d: 0,
    next30d: 0,
    expiredUnclosed: 0,
  }
  for (const sub of subscriptions as any[]) {
    if (["active", "grace"].includes(sub.status) && sub.expiresAt) {
      const days = (new Date(sub.expiresAt).getTime() - now.getTime()) / 86400000
      if (days <= 7) upcomingExpiry.next7d += 1
      if (days <= 30) upcomingExpiry.next30d += 1
    } else if (sub.status === "expired") {
      upcomingExpiry.expiredUnclosed += 1
    }
  }

  const planBreakdown: Record<string, { subscriptions: number; upgradeGb: number }> = {}
  for (const sub of subscriptions as any[]) {
    const key = String(sub.plan?.name || "Legacy / None")
    if (!planBreakdown[key]) planBreakdown[key] = { subscriptions: 0, upgradeGb: 0 }
    planBreakdown[key].subscriptions += 1
    planBreakdown[key].upgradeGb += n(sub.upgradeStorageGb)
  }

  const activeUpgradeGb = upgrades.reduce((acc: number, u: any) => acc + n(u.gb), 0)
  const overageUnbilledGb = overageRows.reduce((acc: number, o: any) => acc + n(o.overageGb), 0)
  const overageUnbilledAmount = overageRows.reduce((acc: number, o: any) => acc + n(o.amount), 0)

  const wallet = walletRows.reduce(
    (acc, row: any) => {
      acc.gross += n(row.amount)
      acc.gatewayFee += n(row.gatewayFee)
      const gateway = String(row.gateway || "unknown").toLowerCase()
      acc.byGateway[gateway] = acc.byGateway[gateway] || { gross: 0, gatewayFee: 0 }
      acc.byGateway[gateway].gross += n(row.amount)
      acc.byGateway[gateway].gatewayFee += n(row.gatewayFee)
      return acc
    },
    { gross: 0, gatewayFee: 0, byGateway: {} as Record<string, { gross: number; gatewayFee: number }> },
  )

  const refunds = refundRows.reduce(
    (acc, row: any) => {
      acc.total += n(row.amount)
      if (/snapshot/i.test(String(row.reason || "")) || /snapshot-refund/.test(String(row.referenceId || ""))) {
        acc.snapshot += n(row.amount)
      }
      return acc
    },
    { total: 0, snapshot: 0 },
  )

  const snapshotChargesStatus: Record<string, number> = {}
  let snapshotChargesFailedOrPendingRefund = 0
  for (const charge of snapshotCharges as any[]) {
    const status = String(charge.status || "unknown")
    snapshotChargesStatus[status] = (snapshotChargesStatus[status] || 0) + 1
    if (["failed", "refund_pending"].includes(status)) snapshotChargesFailedOrPendingRefund += 1
  }

  return NextResponse.json(
    {
      success: true,
      asOf: now.toISOString(),
      revenue: {
        totalPaid,
        totalTax,
        billableCount,
        byKind: revenueByKind,
      },
      snapshots: {
        chargesByStatus: snapshotChargesStatus,
        chargesPendingRefund: snapshotChargesFailedOrPendingRefund,
      },
      subscriptions: {
        byStatus,
        total: subscriptions.length,
        upcomingExpiry,
        planBreakdown,
      },
      storage: {
        activeUpgradeGb,
        overageUnbilledGb,
        overageUnbilledAmount,
      },
      wallet: {
        topupGross: n(wallet.gross),
        topupGatewayFee: n(wallet.gatewayFee),
        byGateway: wallet.byGateway,
      },
      refunds: {
        total: n(refunds.total),
        snapshot: n(refunds.snapshot),
      },
    },
    { headers: NO_CACHE_HEADERS },
  )
}