import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManagePaymentGateways } from "@/lib/admin-rbac"
import { decryptGatewayCredentials } from "@/lib/payments/domain-gateway-credentials"
import { createPanelLog } from "@/lib/panel-log"
import { getPrimaryPaymentDomain, normalizePaymentDomain } from "@/lib/payments/primary-domain"

function unauthorized() {
  return NextResponse.json({ ok: false, code: "ADMIN_UNAUTHORIZED", error: "Your admin session expired. Please sign in again." }, { status: 401 })
}

function result(ok: boolean, gateway: string, environment: string, message: string, extra: Record<string, unknown> = {}) {
  return { ok, success: ok, gateway, environment, message, checkedAt: new Date().toISOString(), ...extra }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManagePaymentGateways(admin.role)) return unauthorized()
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const testType = String(body.testType || body.type || "credentials")
  const config = await prisma.domainGatewayConfig.findUnique({ where: { id }, include: { domain: true } })
  if (!config) return NextResponse.json({ ok: false, code: "GATEWAY_NOT_FOUND", error: "Gateway config not found." }, { status: 404 })
  await createPanelLog({
    category: "Payment",
    message: "gateway_test_started",
    actorType: "admin",
    actorEmail: String(admin.email),
    metadata: { gateway: config.gateway, gatewayConfigId: config.id, testType },
  }).catch(() => null)
  const credentials = decryptGatewayCredentials(config)
  const required = config.gateway === "cashfree"
    ? ["appId", "secretKey"]
    : config.gateway === "phonepe"
      ? ["merchantId", "clientId", "clientSecret", "clientVersion"]
      : []
  const missing = required.filter((key) => !credentials[key])
  let payload = result(
    missing.length === 0,
    config.gateway,
    config.environment,
    missing.length ? `Missing credentials: ${missing.join(", ")}` : "Gateway credentials are present.",
    { domain: config.domain.domain, code: missing.length ? "GATEWAY_CREDENTIALS_MISSING" : "GATEWAY_CONFIG_PRESENT", missing },
  )
  let status = missing.length ? 400 : 200
  const primaryDomain = await getPrimaryPaymentDomain()
  const approved = normalizePaymentDomain(primaryDomain?.domain || config.domain.domain)

  if (!missing.length && testType === "webhook") {
    const url = String(config.webhookUrl || "")
    let urlHost = ""
    try {
      urlHost = url ? new URL(url).host.replace(/^www\./, "") : ""
    } catch {
      urlHost = ""
    }
    const ok = Boolean(url.startsWith("https://") && urlHost === approved)
    payload = result(ok, config.gateway, config.environment, ok ? "Webhook endpoint URL is HTTPS and matches the primary platform domain." : "Webhook endpoint URL must be HTTPS and match the primary platform domain.", {
      domain: config.domain.domain,
      code: ok ? "WEBHOOK_ENDPOINT_VALID" : "WEBHOOK_ENDPOINT_INVALID",
    })
    status = ok ? 200 : 400
  }

  if (!missing.length && testType === "payment_initialization") {
    const production = String(config.environment).toLowerCase() === "production"
    const confirmed = Boolean(body.confirmLive)
    if (production && !confirmed) {
      payload = result(false, config.gateway, config.environment, "This will create a live payment attempt.", { code: "LIVE_TEST_CONFIRMATION_REQUIRED" })
      status = 409
    } else {
      const amount = Number(body.amount || (production ? 10 : 1))
      const attempt = await prisma.paymentAttempt.create({
        data: {
          gateway: config.gateway,
          domainId: config.domainId,
          gatewayConfigId: config.id,
          sourceDomain: config.domain.domain,
          approvedDomain: approved,
          approvedPaymentDomain: approved,
          merchantOrderId: `TEST-${Date.now().toString(36).toUpperCase()}`,
          amount,
          currency: "INR",
          status: "test_created",
          mode: "direct",
          rawGatewayResponse: { test: true, createdBy: admin.email, type: "payment_initialization" } as any,
        },
      })
      payload = result(true, config.gateway, config.environment, "Test payment attempt record created. Gateway network call was not made from this safety check.", {
        code: "TEST_PAYMENT_ATTEMPT_CREATED",
        paymentAttemptId: attempt.id,
        amount,
      })
    }
  }

  await prisma.domainGatewayConfig.update({
    where: { id: config.id },
    data: {
      extraConfig: {
        ...((config.extraConfig as any) || {}),
        lastTestResult: payload,
      },
    },
  }).catch(() => null)
  await createPanelLog({
    category: "Payment",
    message: payload.ok ? "gateway_test_passed" : "gateway_test_failed",
    actorType: "admin",
    actorEmail: String(admin.email),
    metadata: { gateway: config.gateway, gatewayConfigId: config.id, testType, code: (payload as any).code || null },
  }).catch(() => null)
  return NextResponse.json(payload, { status })
}
