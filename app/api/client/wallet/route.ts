import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getClientFromCookies } from "@/lib/server-auth"
import { getBillingPricingSettings, getPaymentSettings } from "@/lib/settings"
import { WALLET_TOPUP_PURPOSE, LEGACY_WALLET_TOPUP_PURPOSE, resolveMinimumWalletTopupAmount } from "@/lib/wallet-topup"
import { getRegionalPrice, getUserCountry } from "@/lib/regional-pricing"

export async function GET(request: Request) {
  const client = await getClientFromCookies()
  if (!client?.sub || !client.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const [customer, pendingTopup, billingPricing, paymentSettings] = await Promise.all([
    prisma.customer.findUnique({
      where: { id: String(client.sub) },
      select: {
        id: true,
        email: true,
        walletBalance: true,
        walletTransactions: {
          orderBy: { createdAt: "desc" },
          take: 100,
        },
      },
    }),
    prisma.payment.findFirst({
      where: {
        customerId: String(client.sub),
        purpose: { in: [WALLET_TOPUP_PURPOSE, LEGACY_WALLET_TOPUP_PURPOSE] },
        status: { in: ["created", "pending", "pending_manual"] },
        walletTransactions: {
          none: { type: { in: ["CREDIT_TOPUP", "topup"] } },
        },
      },
      include: {
        invoice: { select: { id: true, invoiceNumber: true } },
        paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1, include: { gatewayConfig: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    getBillingPricingSettings().catch(() => null),
    getPaymentSettings().catch(() => null),
  ])

  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 })
  const minimumTopupAmount = resolveMinimumWalletTopupAmount({ billingPricing, paymentSettings })
  const countryCode = await getUserCountry(request)
  const localizedBalance = await getRegionalPrice({
    amountInr: Number(customer.walletBalance),
    countryCode,
    customerId: String(client.sub),
    context: { source: "client_wallet_balance" },
  }).catch(() => null)
  const localizedMinimumTopup = await getRegionalPrice({
    amountInr: minimumTopupAmount,
    countryCode,
    customerId: String(client.sub),
    context: { source: "client_wallet_minimum_topup" },
  }).catch(() => null)

  return NextResponse.json({
    balance: Number(customer.walletBalance),
    currency: "INR",
    baseCurrency: "INR",
    localizedBalance,
    minimumTopupAmount,
    localizedMinimumTopup,
    transactions: customer.walletTransactions.map((transaction) => {
      const amount = Number(transaction.amount || 0)
      return {
        ...transaction,
        currency: "INR",
        baseCurrency: "INR",
        localizedAmount: amount,
      }
    }),
    pendingTopup: pendingTopup ? {
      id: pendingTopup.id,
      invoiceId: pendingTopup.invoiceId,
      invoiceNumber: pendingTopup.invoice?.invoiceNumber || null,
      amount: Number(pendingTopup.amount || 0),
      currency: "INR",
      gateway: pendingTopup.gateway,
      gatewayOrderId: pendingTopup.gatewayOrderId,
      paymentSessionId: pendingTopup.gatewaySessionId,
      paymentUrl: pendingTopup.paymentAttempts[0]?.redirectUrl || null,
      redirectUrl: pendingTopup.paymentAttempts[0]?.redirectUrl || null,
      mode: String(pendingTopup.paymentAttempts[0]?.gatewayConfig?.environment || "sandbox").toLowerCase() === "production" ? "production" : "sandbox",
      statusUrl: `/payment/status?order_id=${encodeURIComponent(pendingTopup.gatewayOrderId || pendingTopup.topupReference || pendingTopup.id)}`,
      status: pendingTopup.status,
      createdAt: pendingTopup.createdAt,
    } : null,
  })
}
