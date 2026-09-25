import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getClientFromRequest } from "@/lib/server-auth"
import { getBillingPricingSettings, getPaymentSettings } from "@/lib/settings"
import { createWalletTopupPayment, normalizeWalletTopupAmount, resolveMinimumWalletTopupAmount } from "@/lib/wallet-topup"
import { formatCurrency } from "@/lib/currency-format"
import { getRegionalPrice, getUserCountry } from "@/lib/regional-pricing"
import { computeGatewayFee, resolveTopupLimits } from "@/lib/billing/gateway-fee"

function jsonError(message: string, status = 400, code = "wallet_topup_error") {
  return NextResponse.json({ ok: false, success: false, code, message, error: message }, { status })
}

export async function POST(request: NextRequest) {
  try {
    const client = await getClientFromRequest(request)
    if (!client?.sub || !client.email) {
      return jsonError("Please login to top up your wallet.", 401, "login_required")
    }

    const body = await request.json().catch(() => ({}))
    const amount = normalizeWalletTopupAmount((body as { amount?: unknown }).amount)
    const [billingPricing, paymentSettings] = await Promise.all([
      getBillingPricingSettings().catch(() => null),
      getPaymentSettings().catch(() => null),
    ])
    const minimum = resolveMinimumWalletTopupAmount({ billingPricing, paymentSettings })

    if (amount === null) {
      return jsonError("Enter a numeric wallet top-up amount.", 400, "invalid_amount")
    }
    if (amount <= 0) {
      return jsonError("Wallet top-up amount must be greater than zero.", 400, "invalid_amount")
    }
    if (amount < minimum) {
      const countryCode = await getUserCountry(request).catch(() => "IN")
      const regionalMinimum = await getRegionalPrice({ amountInr: minimum, countryCode, customerId: String(client.sub), context: { source: "wallet_topup_minimum" } }).catch(() => null)
      const fallbackMinimumMessage = `Minimum top-up amount is ${formatCurrency(minimum, "INR")}`
      return jsonError(regionalMinimum?.formatted ? `Minimum top-up amount is ${regionalMinimum.formatted}` : fallbackMinimumMessage, 400, "minimum_topup_amount")
    }
    const limits = await resolveTopupLimits({ billingMinimum: minimum })
    if (limits.maxTopup > 0 && amount > limits.maxTopup) {
      return jsonError(`Maximum wallet top-up amount is ${formatCurrency(limits.maxTopup, "INR")}`, 400, "max_topup_amount")
    }

    const customer = await prisma.customer.findUnique({
      where: { id: String(client.sub) },
      select: { id: true, email: true, name: true, phone: true },
    })
    if (!customer || customer.email !== client.email) {
      return jsonError("Wallet top-up is only available for your own account.", 403, "unauthorized")
    }

    const payload = await createWalletTopupPayment({
      request,
      customer,
      amount,
      preferredGateway: typeof body?.gateway === "string" ? body.gateway : null,
    })

    const fee = await computeGatewayFee({ gateway: typeof payload?.gateway === "string" ? payload.gateway : "razorpay", grossAmount: amount })
    return NextResponse.json({
      ...payload,
      fee: {
        grossAmount: fee.grossAmount,
        feePercent: fee.feePercent,
        fixedFee: fee.fixedFee,
        feeAmount: fee.feeAmount,
        netAmount: fee.netAmount,
      },
    })
  } catch (error: any) {
    console.error("Wallet topup error:", error)
    const status = Number(error?.status || error?.statusCode || 500)
    if (error?.code === "NO_GATEWAY_AVAILABLE") {
      return jsonError(error.message || "No payment gateway is available. Please contact support.", status, "NO_GATEWAY_AVAILABLE")
    }
    if (error?.code === "PAYMENT_START_FAILED") {
      return jsonError(error.message || "Payment could not be started. Please try again.", status, "PAYMENT_START_FAILED")
    }
    return jsonError("Wallet top-up could not be started. Please try again.", 500, "server_error")
  }
}
