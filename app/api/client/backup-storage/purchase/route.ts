import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { createBackupStorageUpgradeOrder } from "@/lib/billing/billable-orders"
import { resolveBackupEntitlement } from "@/lib/billing/entitlements"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export async function POST(request: NextRequest) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })

  const body = await request.json().catch(() => ({}))
  const gb = Math.max(1, Math.floor(Number(body.gb || 0) || 0))
  const termMonths = Math.max(1, Math.min(12, Math.floor(Number(body.termMonths || 1) || 1)))
  if (!gb) return NextResponse.json({ error: "gb is required" }, { status: 400, headers: NO_CACHE_HEADERS })

  const entitlement = await resolveBackupEntitlement(customerId).catch(() => null)
  const current = entitlement?.entitlement
  if (!current?.subscriptionId) {
    return NextResponse.json({ success: false, error: "Purchase a backup plan before adding extra storage." }, { status: 409, headers: NO_CACHE_HEADERS })
  }

  const subscription = await prisma.backupSubscription.findUnique({
    where: { id: current.subscriptionId },
    include: { plan: true },
  })
  if (!subscription || !["active", "grace"].includes(subscription.status)) {
    return NextResponse.json({ success: false, error: "Your backup plan is not active." }, { status: 409, headers: NO_CACHE_HEADERS })
  }

  const pricePerGb = Number(subscription.extraStoragePricePerGb || subscription.plan?.extraStoragePricePerGb || current.extraStoragePricePerGb || 0)
  if (pricePerGb <= 0) {
    return NextResponse.json({ success: false, error: "Extra storage is not available on your current plan." }, { status: 409, headers: NO_CACHE_HEADERS })
  }

  const maxCap = subscription.plan?.maxStorageCapGb != null ? Number(subscription.plan.maxStorageCapGb) : null
  if (maxCap != null && maxCap > 0 && Number(subscription.upgradeStorageGb || 0) + Number(subscription.plan.storageQuotaGb || 0) + gb > maxCap) {
    return NextResponse.json({ success: false, error: `Extra storage cannot exceed the plan cap (${maxCap} GB).` }, { status: 409, headers: NO_CACHE_HEADERS })
  }

  const created = await createBackupStorageUpgradeOrder({
    customerId,
    subscriptionId: subscription.id,
    gb,
    pricePerGb,
    termMonths,
  })
  const wallet = await prisma.customer.findUnique({ where: { id: customerId }, select: { walletBalance: true } })
  const walletBalance = Number(wallet?.walletBalance || 0)

  return NextResponse.json({
    success: true,
    orderId: created.order.id,
    orderNumber: created.order.orderNumber,
    quote: created.quote,
    wallet: { balance: walletBalance, sufficient: walletBalance >= created.quote.total },
    idempotencyKey: `billable:${created.order.id}`,
  }, { headers: NO_CACHE_HEADERS })
}