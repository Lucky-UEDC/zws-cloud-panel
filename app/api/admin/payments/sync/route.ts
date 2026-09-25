import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { reconcileCashfreeOrder } from "@/lib/payment-reconciliation"
import { prisma } from "@/lib/db"
import { isWalletTopupPurpose } from "@/lib/wallet-topup"

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const orderId = String(body.orderId || body.orderNumber || body.gatewayOrderId || "").trim()
  if (!orderId) return NextResponse.json({ error: "Order ID is required" }, { status: 400 })
  const result = await reconcileCashfreeOrder(orderId, `admin:${admin.email}`)
  const payment = await prisma.payment.findFirst({
    where: {
      OR: [
        { id: orderId },
        { gatewayOrderId: orderId },
        { topupReference: orderId },
        { paymentAttempts: { some: { merchantOrderId: orderId } } },
      ],
    },
    include: {
      walletTransactions: { where: { type: { in: ["CREDIT_TOPUP", "topup"] } }, orderBy: { createdAt: "desc" }, take: 1 },
      paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  }).catch(() => null)

  let verification: "credited" | "already_credited" | "unpaid" | "failed" | "amount_mismatch" = "unpaid"
  if (payment && isWalletTopupPurpose(payment.purpose)) {
    const status = String(payment.status || "").toLowerCase()
    const hasCredit = Boolean(payment.walletTransactions?.[0])
    const mismatch = result?.status === "amount_or_currency_mismatch"
    if (mismatch) verification = "amount_mismatch"
    else if (hasCredit && ["completed", "paid", "success", "verification_pending"].includes(status)) {
      verification = result?.paid ? "credited" : "already_credited"
    } else if (["failed", "payment_failed", "cancelled", "canceled"].includes(status) || result?.failed) {
      verification = "failed"
    } else {
      verification = "unpaid"
    }
  }

  return NextResponse.json({
    success: true,
    result,
    verification,
    diagnostics: {
      gatewayOrderIdUsed: result.gatewayOrderIdUsed || null,
      attemptedReferences: result.attemptedReferences || [],
      gatewayHttpStatus: result.gatewayHttpStatus ?? null,
      lastGatewayError: result.lastGatewayError || null,
      rawGatewaySummary: result.rawGatewaySummary || null,
    },
  })
}
