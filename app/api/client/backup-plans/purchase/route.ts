import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { createBackupPlanOrder } from "@/lib/billing/billable-orders"
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
  const planId = String(body.planId || "")
  const termMonths = Math.max(1, Math.min(12, Math.floor(Number(body.termMonths || 1) || 1)))

  if (!planId) return NextResponse.json({ error: "planId is required" }, { status: 400, headers: NO_CACHE_HEADERS })

  const plan = await prisma.backupPlan.findFirst({ where: { id: planId, active: true, archived: false } })
  if (!plan) return NextResponse.json({ error: "Backup plan not found" }, { status: 404, headers: NO_CACHE_HEADERS })

  const entitlement = await resolveBackupEntitlement(customerId).catch(() => null)
  const subscription = entitlement?.entitlement?.subscriptionId
    ? await prisma.backupSubscription.findUnique({ where: { id: entitlement.entitlement.subscriptionId } }).catch(() => null)
    : null
  if (subscription && subscription.planId === plan.id && ["active", "grace"].includes(subscription.status)) {
    return NextResponse.json({ success: false, error: "This plan is already active on your account." }, { status: 409, headers: NO_CACHE_HEADERS })
  }

  const created = await createBackupPlanOrder({ customerId, planId, termMonths })
  const wallet = await prisma.customer.findUnique({ where: { id: customerId }, select: { walletBalance: true } })
  const walletBalance = Number(wallet?.walletBalance || 0)

  return NextResponse.json({
    success: true,
    orderId: created.order.id,
    orderNumber: created.order.orderNumber,
    quote: created.quote,
    wallet: { balance: walletBalance, sufficient: walletBalance >= created.quote.total },
    idempotencyKey: `billable:${created.order.id}`,
    plan: { id: plan.id, name: plan.name, slug: plan.slug },
  }, { headers: NO_CACHE_HEADERS })
}