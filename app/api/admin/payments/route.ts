import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { safeJson } from "@/lib/safe-json"
import { maskSensitiveGatewayPayload, serializePaymentDetails } from "@/lib/payments/payment-details"

export async function GET(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const status = request.nextUrl.searchParams.get("status")
  const purpose = request.nextUrl.searchParams.get("purpose")
  const gateway = request.nextUrl.searchParams.get("gateway")
  const domain = request.nextUrl.searchParams.get("domain")
  const search = request.nextUrl.searchParams.get("search")

  const payments = await prisma.payment.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(purpose ? { purpose } : {}),
      ...(gateway ? { gateway } : {}),
      ...(search ? {
        OR: [
          { gatewayOrderId: { contains: search, mode: "insensitive" } },
          { gatewayPaymentId: { contains: search, mode: "insensitive" } },
          { transactionId: { contains: search, mode: "insensitive" } },
          { gatewayTransactionId: { contains: search, mode: "insensitive" } },
          { paymentAttempts: { some: { merchantOrderId: { contains: search, mode: "insensitive" } } } },
          { paymentAttempts: { some: { gatewayTransactionId: { contains: search, mode: "insensitive" } } } },
        ],
      } : {}),
      ...(domain ? { paymentAttempts: { some: { sourceDomain: domain } } } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { id: true, email: true, name: true } },
      order: { select: { id: true, orderNumber: true, status: true } },
      invoice: { select: { id: true, invoiceNumber: true } },
      checkoutSession: { select: { id: true, referenceId: true, status: true, purpose: true, fulfilledOrderId: true, fulfilledAt: true } },
      paymentAttempts: {
        orderBy: { createdAt: "desc" },
        take: 3,
      },
      webhookEvents: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  })

  return NextResponse.json(safeJson({
    payments: payments.map((payment) => {
      const latestAttempt = payment.paymentAttempts?.[0] || null
      const verifiedAt = latestAttempt?.webhookVerifiedAt || payment.completedAt || null
      return {
      ...payment,
      verified: ["completed", "paid", "success"].includes(String(payment.status || "").toLowerCase()) && Boolean(verifiedAt || payment.gateway === "wallet"),
      verifiedAt,
      paymentDetails: serializePaymentDetails({ payment, paymentAttempt: latestAttempt }),
      gatewayResponse: maskSensitiveGatewayPayload(payment.gatewayResponse),
      paymentAttempts: payment.paymentAttempts?.map((attempt) => ({
        ...attempt,
        rawGatewayResponse: maskSensitiveGatewayPayload(attempt.rawGatewayResponse),
      })),
      webhookEvents: payment.webhookEvents?.map((event) => ({
        ...event,
        payload: maskSensitiveGatewayPayload(event.payload),
      })),
    }}),
  }))
}
