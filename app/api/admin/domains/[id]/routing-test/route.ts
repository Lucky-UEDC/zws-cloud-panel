import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManagePaymentGateways } from "@/lib/admin-rbac"
import { createPanelLog } from "@/lib/panel-log"
import { getPrimaryPaymentDomain, normalizePaymentDomain } from "@/lib/payments/primary-domain"

const GATEWAYS = ["phonepe", "cashfree", "manual", "wallet"] as const

function unauthorized() {
  return NextResponse.json({ ok: false, code: "ADMIN_UNAUTHORIZED", error: "Your admin session expired. Please sign in again." }, { status: 401 })
}

function metadataObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

function fallbackBehavior(domain: any) {
  return String(metadataObject(metadataObject(domain.metadata).paymentRouting).fallbackBehavior || "default_init_fails")
}

function normalizeGateway(value?: string | null) {
  const gateway = String(value || "").toLowerCase()
  return GATEWAYS.includes(gateway as any) ? gateway : null
}

function decision(domain: any) {
  const enabledGateways = (domain.gatewayConfigs || []).filter((config: any) => config.enabled).map((config: any) => config.gateway)
  const defaultGateway = normalizeGateway(domain.defaultGateway)
  const fallbackGateway = normalizeGateway(domain.fallbackGateway)
  const behavior = fallbackBehavior(domain)
  const fallbackAvailable = Boolean(behavior !== "disabled" && fallbackGateway && enabledGateways.includes(fallbackGateway))
  const selectedGateway = defaultGateway && enabledGateways.includes(defaultGateway)
    ? defaultGateway
    : fallbackAvailable
      ? fallbackGateway
      : null
  return {
    domain: domain.domain,
    defaultGateway: defaultGateway || "none",
    fallbackGateway: fallbackGateway || "none",
    fallbackBehavior: behavior,
    enabledGateways,
    selectedGateway,
    fallbackAvailable,
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManagePaymentGateways(admin.role)) return unauthorized()
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const testType = String(body.testType || "routing_decision")
  const domain = await prisma.domainConfig.findUnique({
    where: { id },
    include: { gatewayConfigs: { orderBy: { priority: "asc" } } },
  })
  if (!domain) return NextResponse.json({ ok: false, code: "DOMAIN_NOT_FOUND", error: "Domain not found." }, { status: 404 })

  const payload = decision(domain)
  const primaryDomain = normalizePaymentDomain((await getPrimaryPaymentDomain())?.domain || domain.domain)
  if (testType === "default_gateway") {
    const config = domain.gatewayConfigs.find((item) => item.gateway === payload.defaultGateway)
    if (!config?.enabled) return NextResponse.json({ ok: false, ...payload, code: "DEFAULT_GATEWAY_DISABLED", error: "Selected default gateway is disabled." }, { status: 400 })
  }
  if (testType === "fallback_gateway") {
    const config = domain.gatewayConfigs.find((item) => item.gateway === payload.fallbackGateway)
    if (payload.fallbackGateway !== "none" && !config?.enabled) return NextResponse.json({ ok: false, ...payload, code: "FALLBACK_GATEWAY_DISABLED", error: "Selected fallback gateway is disabled." }, { status: 400 })
  }
  if (testType === "payment_initialization") {
    const gatewayConfig = domain.gatewayConfigs.find((item) => item.gateway === payload.selectedGateway)
    if (!gatewayConfig) return NextResponse.json({ ok: false, ...payload, code: "NO_GATEWAY_AVAILABLE", error: "No payment gateway is available for this domain." }, { status: 400 })
    const attempt = await prisma.paymentAttempt.create({
      data: {
        gateway: gatewayConfig.gateway,
        domainId: domain.id,
        gatewayConfigId: gatewayConfig.id,
        sourceDomain: domain.domain,
        approvedDomain: primaryDomain,
        approvedPaymentDomain: primaryDomain,
        merchantOrderId: `TEST-${Date.now().toString(36).toUpperCase()}`,
        amount: 1,
        currency: "INR",
        status: "test_created",
        mode: "direct",
        rawGatewayResponse: { test: true, networkCallMade: false, createdBy: admin.email } as any,
      },
    })
    await createPanelLog({ category: "Payment", message: "domain_routing_payment_initialization_test", actorType: "admin", actorEmail: String(admin.email), metadata: { domain: domain.domain, gateway: gatewayConfig.gateway, paymentAttemptId: attempt.id } }).catch(() => null)
    return NextResponse.json({ ok: true, ...payload, paymentAttemptId: attempt.id, message: "Test payment attempt created without a gateway network call." })
  }

  await createPanelLog({ category: "Payment", message: "domain_routing_test", actorType: "admin", actorEmail: String(admin.email), metadata: { testType, ...payload } }).catch(() => null)
  return NextResponse.json({ ok: true, ...payload, message: "Routing decision test complete." })
}
