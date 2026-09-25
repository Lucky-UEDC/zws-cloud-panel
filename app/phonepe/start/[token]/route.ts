import { NextRequest, NextResponse } from "next/server"
import { consumePaymentBridgeToken } from "@/lib/payments/bridge"
import { createPhonePePaymentSession } from "@/lib/phonepe"
import { decryptGatewayCredentials } from "@/lib/payments/domain-gateway-credentials"
import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"
import { getBaseUrl, paymentWebhookUrl } from "@/lib/runtime-site-url"

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const attempt = await consumePaymentBridgeToken(token)
  if (!attempt) {
    return new NextResponse("Payment link expired.", { status: 410, headers: { "content-type": "text/plain; charset=utf-8" } })
  }
  const origin = getBaseUrl(request)
  const credentials = decryptGatewayCredentials(attempt.gatewayConfig || {})
  try {
    const session = await createPhonePePaymentSession({
      orderId: attempt.merchantOrderId,
      amount: Number(attempt.amount),
      customerId: attempt.userId || attempt.order?.customerId || "guest",
      customerPhone: attempt.order?.customer?.phone || "9999999999",
      redirectUrl: `${origin}/phonepe/return?merchantOrderId=${encodeURIComponent(attempt.merchantOrderId)}`,
      callbackUrl: attempt.gatewayConfig?.webhookUrl || paymentWebhookUrl("phonepe", origin),
    }, {
      merchantId: String(credentials.merchantId || ""),
      clientId: String(credentials.clientId || ""),
      clientSecret: String(credentials.clientSecret || ""),
      clientVersion: String(credentials.clientVersion || ""),
      webhookUsername: String(credentials.webhookUsername || ""),
      webhookPassword: String(credentials.webhookPassword || ""),
      webhookSecret: String(credentials.webhookPassword || credentials.webhookSecret || ""),
      environment: String(attempt.gatewayConfig?.environment || "production") === "production" ? "production" : "sandbox",
    })
    await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "started",
        gatewayOrderId: session.gatewayOrderId,
        redirectUrl: session.redirectUrl,
        rawGatewayResponse: session.raw as any,
      },
    })
    await createPanelLog({
      category: "Payment",
      message: "phonepe_bridge_started",
      customerId: attempt.userId || null,
      metadata: { paymentAttemptId: attempt.id, merchantOrderId: attempt.merchantOrderId },
    }).catch(() => null)
    return NextResponse.redirect(session.redirectUrl)
  } catch (error: any) {
    await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: { status: "failed", failureCode: String(error?.code || "PHONEPE_START_FAILED"), failureMessage: String(error?.message || "PhonePe start failed").slice(0, 500) },
    }).catch(() => null)
    return new NextResponse("Could not start PhonePe payment.", { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } })
  }
}
