import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getClientFromCookies } from "@/lib/server-auth"
import { createRenewalInvoice, renewVpsFromPaidInvoice } from "@/lib/renewals"
import { getCashfreeRuntimeConfig } from "@/lib/cashfree"
import { getSetting, type PaymentSettings } from "@/lib/settings"
import { getUsableGatewayCandidates, resolvePaymentGateway } from "@/lib/payments/domain-gateway-resolver"
import { paymentWebhookUrl } from "@/lib/runtime-site-url"
import { createDomainGatewayPaymentSession, gatewayCredentials } from "@/lib/payment-gateways"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const client = await getClientFromCookies()
  const customerId = String(client?.sub || "")
  if (!customerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const vps = await prisma.vpsInstance.findFirst({
    where: { OR: [{ id }, { orderId: id }], customerId, deletedAt: null, status: { not: "DELETED" } },
    include: { customer: true, product: true, order: true, proxmoxNode: true },
  })
  if (!vps) return NextResponse.json({ error: "Instance not found" }, { status: 404 })

  const invoice = await createRenewalInvoice(vps)
  const paymentSettings = await getSetting<PaymentSettings>("payment_settings")
  const bypass = process.env.NODE_ENV !== "production" && Boolean(paymentSettings.paymentBypassTestMode)
  if (bypass) {
    const paid = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "paid", paidAt: new Date() },
    })
    await renewVpsFromPaidInvoice(paid)
    return NextResponse.json({ success: true, paid: true, message: "Renewal paid by bypass", redirectUrl: `/client-area/vps/${vps.id}` })
  }

  const resolution = await resolvePaymentGateway({ request }).catch(() => null)
  const credentials = gatewayCredentials(resolution?.gatewayConfig || {})
  const activePaymentMode = bypass ? "mock" : String(resolution?.gatewayConfig?.environment || "sandbox")
  const runtime = getCashfreeRuntimeConfig({
    appId: credentials.appId ? "configured" : undefined,
    secretKey: credentials.secretKey ? "configured" : undefined,
    mode: activePaymentMode as any,
  })

  if (runtime.paymentMode === "mock") {
    const paid = await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "paid", paidAt: new Date() } })
    await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        customerId,
        gateway: "cashfree",
        gatewayOrderId: `mock-renew-${invoice.invoiceNumber}`,
        amount: Number(invoice.totalAmount),
        gatewayAmount: Number(invoice.totalAmount),
        currency: invoice.currency,
        status: "completed",
        purpose: "renewal_invoice",
        completedAt: new Date(),
        errorMessage: "Test renewal payment simulated",
      },
    })
    await renewVpsFromPaidInvoice(paid)
    return NextResponse.json({ success: true, paid: true, message: "Renewal paid in mock mode", redirectUrl: `/client-area/vps/${vps.id}` })
  }

  const required = (gateway: string) => gateway === "razorpay" ? ["keyId", "keySecret", "webhookSecret"] : gateway === "cashfree" ? ["appId", "secretKey"] : gateway === "phonepe" ? ["merchantId", "clientId", "clientSecret", "clientVersion"] : []
  const ready = (config: any) => Boolean(config?.enabled) && required(config.gateway).every((key) => Boolean(gatewayCredentials(config)[key]))
  if (!resolution) {
    return NextResponse.json({ ok: false, code: "NO_GATEWAY_AVAILABLE", error: "Payment gateway configuration could not be resolved for this domain." }, { status: 503 })
  }
  const gatewayConfigs = getUsableGatewayCandidates(resolution, "card_upi")
  for (const config of gatewayConfigs) {
    if (!ready(config)) continue
    if (String(config.gateway) !== "razorpay") continue
    const referenceId = `REN-${invoice.invoiceNumber}`
    const approvedDomain = resolution.approvedPaymentDomain || resolution.sourceDomain
    const baseUrl = String(resolution.approvedBaseUrl || resolution?.baseUrl)
    const returnUrl = String(config.returnUrl || `${baseUrl}/payment/status?order_id={order_id}`).replace(/\{order_id\}/g, encodeURIComponent(referenceId))
    const webhookUrl = String(config.webhookUrl || paymentWebhookUrl(config.gateway, baseUrl)).replace(/\{order_id\}/g, encodeURIComponent(referenceId))
    let order: Awaited<ReturnType<typeof createDomainGatewayPaymentSession>>
    let checkoutSession: { id: string } | null = null
    try {
      checkoutSession = await prisma.checkoutSession.create({
        data: {
          referenceId,
          customerId,
          invoiceId: invoice.id,
          status: "pending",
          purpose: "renewal_invoice",
          gateway: config.gateway,
          amount: Number(invoice.totalAmount),
          currency: invoice.currency,
          snapshot: {
            source: "vps_renewal",
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            vpsInstanceId: vps.id,
            orderId: vps.orderId,
          },
        },
      })
      order = await createDomainGatewayPaymentSession({
        gateway: "razorpay",
        orderId: referenceId,
        amount: Number(invoice.totalAmount),
        customerDetails: {
          customerId,
          customerEmail: String(client?.email || vps.customer.email),
          customerPhone: String(vps.customer.phone || "0000000000"),
          customerName: String(vps.customer.name || "Client"),
        },
        orderNote: `VPS renewal ${vps.name}`,
        returnUrl,
        webhookUrl,
        gatewayConfig: config,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
      })
    } catch (error) {
      if (checkoutSession?.id) {
        await prisma.checkoutSession.update({ where: { id: checkoutSession.id }, data: { status: "payment_failed" } }).catch(() => undefined)
      }
      console.warn("[Renewal] gateway initialization failed", { gateway: config.gateway, invoiceId: invoice.id, message: error instanceof Error ? error.message : String(error) })
      continue
    }
    const payment = await prisma.payment.upsert({
      where: { idempotencyKey: `${referenceId}-razorpay-init` },
      update: {},
      create: {
        checkoutSessionId: checkoutSession?.id || null,
        invoiceId: invoice.id,
        customerId,
        gateway: "razorpay",
        gatewayOrderId: order.gatewayOrderId,
        gatewaySessionId: order.gatewaySessionId,
        gatewayPaymentId: order.gatewayPaymentId,
        gatewayTransactionId: order.gatewayTransactionId,
        amount: Number(invoice.totalAmount),
        gatewayAmount: Number(invoice.totalAmount),
        currency: invoice.currency,
        status: "pending",
        purpose: "renewal_invoice",
        idempotencyKey: `${referenceId}-razorpay-init`,
        gatewayResponse: order.raw as any,
      },
    })
    await prisma.paymentAttempt.upsert({
      where: { merchantOrderId: referenceId },
      update: { paymentId: payment.id, gatewayOrderId: order.gatewayOrderId, rawGatewayResponse: order.raw as any },
      create: {
        invoiceId: invoice.id,
        paymentId: payment.id,
        userId: customerId,
        domainId: resolution.domainConfig?.id || null,
        gatewayConfigId: config.id || null,
        gateway: "razorpay",
        sourceDomain: resolution.sourceDomain,
        approvedDomain: approvedDomain,
        approvedPaymentDomain: approvedDomain,
        merchantOrderId: referenceId,
        gatewayOrderId: order.gatewayOrderId,
        amount: Number(invoice.totalAmount),
        currency: invoice.currency,
        status: "started",
        mode: "direct",
        redirectUrl: order.redirectUrl,
        returnUrl,
        rawGatewayResponse: order.raw as any,
      },
    })
    const checkoutOptions = order.raw?.checkout && typeof order.raw.checkout === "object" && !Array.isArray(order.raw.checkout)
      ? order.raw.checkout as Record<string, any>
      : null
    return NextResponse.json({
      success: true,
      checkoutSessionId: checkoutSession?.id || null,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      paymentSessionId: order.gatewaySessionId,
      payment_session_id: order.gatewaySessionId,
      redirectUrl: order.redirectUrl,
      gatewayOrderId: order.gatewayOrderId,
      checkoutOptions,
      checkout_options: checkoutOptions,
      publicKey: checkoutOptions?.key || order.raw?.keyId || undefined,
      razorpayOrderId: checkoutOptions?.order_id || order.gatewayOrderId,
      razorpay_order_id: checkoutOptions?.order_id || order.gatewayOrderId,
      razorpayFlow: order.raw?.razorpayFlow || "order",
      amount: Number(invoice.totalAmount),
      gateway: "razorpay",
      usedFallback: config.id !== resolution.gatewayConfig?.id,
      status: "gateway_started",
      message: "Opening secure Razorpay checkout...",
    })
  }

  return NextResponse.json({
    ok: false,
    success: false,
    code: "NO_GATEWAY_AVAILABLE",
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    amount: Number(invoice.totalAmount),
    status: invoice.status,
    error: `No usable payment gateway credentials are configured for ${resolution.sourceDomain}. Default gateway: ${resolution.defaultGateway || resolution.gatewayConfig?.gateway || "none"}. Please contact support.`,
  }, { status: 503 })
}
