import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManagePaymentGateways } from "@/lib/admin-rbac"
import { activePaymentGatewayCredentials } from "@/lib/payments/payment-gateway-admin"
import { getBaseUrl, paymentWebhookUrl } from "@/lib/runtime-site-url"
import { createPaymentOrder, testCashfreeAuthentication } from "@/lib/cashfree"
import { createPhonePePaymentSession } from "@/lib/phonepe"
import { validateGatewayRuntime } from "@/lib/runtime-payment-resolver"
import { requireSensitiveAdminMfa } from "@/lib/admin-sensitive-action"
import { validateGatewayRow } from "@/lib/payments/gateway-registry"

async function runConnectionProbe(code: string, gateway: any, credentials: Record<string, any>, webhookUrl: string, options: { confirmLive?: boolean } = {}) {
  const mode = String(gateway.mode || gateway.environment || "test").toLowerCase() === "production" ? "production" : "sandbox"
  if (code === "cashfree") {
    if (mode === "production") {
      const probe = await testCashfreeAuthentication({ ...gateway, credentialsPlain: credentials, environment: mode })
      if (!probe.ok) throw new Error(`${probe.message}${probe.status ? ` (HTTP ${probe.status}).` : ""}`)
      return {
        authMode: "production_non_charging_validation",
        authentication: "passed",
        connectivity: "reachable",
        status: probe.status,
        code: probe.code,
        latencyMs: probe.latencyMs,
        webhookConfigured: Boolean(webhookUrl && (credentials.webhookSecret || credentials.secretKey)),
      }
    }
    const orderId = `TEST-${Date.now().toString(36).toUpperCase()}`
    const order = await createPaymentOrder({
      orderId,
      orderAmount: 1,
      customerDetails: {
        customerId: "admin-gateway-test",
        customerEmail: "admin-gateway-test@example.com",
        customerPhone: "9999999999",
        customerName: "Gateway Test",
      },
      orderMeta: {
        returnUrl: `${getBaseUrl()}/payment/cancel?order_id={order_id}`,
        notifyUrl: webhookUrl,
      },
      orderNote: "Gateway connection test",
    }, {
      appId: String(credentials.appId || ""),
      secretKey: String(credentials.secretKey || ""),
      mode: "sandbox",
      apiVersion: String(credentials.apiVersion || "") || undefined,
    })
    return { testOrderId: order.orderId, gatewayOrderId: order.cfOrderId, webhookConfigured: Boolean(webhookUrl) }
  }
  if (code === "phonepe") {
    if (mode === "production" && !options.confirmLive) {
      return {
        oauthConfigured: Boolean(credentials.clientId && credentials.clientSecret && credentials.clientVersion),
        webhookConfigured: Boolean(webhookUrl && credentials.webhookUsername && credentials.webhookPassword),
        apiReachability: "production_live_payment_creation_skipped",
      }
    }
    const orderId = `TEST-${Date.now().toString(36).toUpperCase()}`
    const session = await createPhonePePaymentSession({
      orderId,
      amount: 1,
      customerId: "admin-gateway-test",
      customerPhone: "9999999999",
      redirectUrl: `${getBaseUrl()}/payment/status?order_id=${encodeURIComponent(orderId)}`,
      callbackUrl: webhookUrl,
    }, {
      merchantId: String(credentials.merchantId || ""),
      clientId: String(credentials.clientId || ""),
      clientSecret: String(credentials.clientSecret || ""),
      clientVersion: String(credentials.clientVersion || ""),
      webhookUsername: String(credentials.webhookUsername || ""),
      webhookPassword: String(credentials.webhookPassword || ""),
      webhookSecret: String(credentials.webhookSecret || credentials.webhookPassword || ""),
      environment: mode,
    })
    return {
      oauthConfigured: true,
      webhookConfigured: Boolean(webhookUrl && credentials.webhookUsername && credentials.webhookPassword),
      apiReachability: "payment_session_created",
      testOrderId: orderId,
      gatewayOrderId: session.gatewayOrderId,
    }
  }
  return {}
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManagePaymentGateways(admin.role)) {
    return NextResponse.json({ ok: false, error: "You do not have permission to manage payment gateways." }, { status: 403 })
  }
  const stepUp = await requireSensitiveAdminMfa(request)
  if (!stepUp.ok) return stepUp.response
  const { id } = await params
  const gateway = await (prisma as any).paymentGateway.findUnique({ where: { id } }).catch(() => null)
  if (!gateway) return NextResponse.json({ ok: false, error: "Payment gateway not found." }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const testType = String(body?.testType || "credentials").toLowerCase()
  const code = String(gateway.code || gateway.provider || "").toLowerCase()
  const credentials = activePaymentGatewayCredentials(gateway)
  const runtime = validateGatewayRuntime({ ...gateway, credentialsPlain: credentials })
  const webhookUrl = paymentWebhookUrl(code, getBaseUrl(request))
  const providerValidation = validateGatewayRow(gateway, getBaseUrl(request))
  const missing = runtime.missingFields.length
    ? runtime.missingFields
    : [...providerValidation.missingFields, ...providerValidation.webhookMissingFields]
  const webhookSecret = providerValidation.webhookMissingFields.length === 0
  const webhookOk = testType !== "webhook" || Boolean(webhookUrl && webhookSecret)
  let probe: Record<string, unknown> = {}
  let probeError: string | null = null
  if (missing.length === 0 && webhookOk && testType !== "webhook") {
    try {
      probe = await runConnectionProbe(code, gateway, runtime.credentials, webhookUrl, { confirmLive: Boolean(body?.confirmLive) })
    } catch (error: any) {
      probeError = error?.message || "Gateway API validation failed"
    }
  }
  const ok = missing.length === 0 && webhookOk && !probeError
  const error = missing.length > 0
    ? `Missing credentials: ${missing.join(", ")}`
    : !webhookOk
      ? "Webhook secret is missing for the active gateway mode."
      : probeError
        ? probeError
      : null
  await (prisma as any).paymentGateway.update({
    where: { id },
    data: {
      lastHealthStatus: ok ? "healthy" : "degraded",
      lastWebhookStatus: testType === "webhook" ? (ok ? "endpoint_configured" : "webhook_secret_missing") : gateway.lastWebhookStatus,
      lastError: ok ? null : error,
      lastHealthCheckedAt: new Date(),
    },
  }).catch(() => null)

  if (!ok) {
    return NextResponse.json({ ok: false, error, missing, webhookUrl, probe }, { status: 400 })
  }
  return NextResponse.json({
    ok: true,
    message: testType === "webhook" ? "Webhook endpoint and secret configuration are ready." : "Gateway configuration is ready for checkout initialization.",
    webhookUrl,
    probe,
  })
}
