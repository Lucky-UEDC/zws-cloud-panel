import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManagePaymentGateways } from "@/lib/admin-rbac"
import { createPanelLog } from "@/lib/panel-log"
import { decryptGatewayCredentials, encryptGatewayCredentials, maskGatewayCredentials } from "@/lib/payments/domain-gateway-credentials"
import { getPrimaryPaymentDomain, normalizePaymentDomain } from "@/lib/payments/primary-domain"
import { revalidatePaymentGateways } from "@/lib/payments/runtime-payment-config"

function unauthorized() {
  return NextResponse.json({ ok: false, code: "ADMIN_UNAUTHORIZED", error: "Your admin session expired. Please sign in again." }, { status: 401 })
}

function serialize(config: any) {
  return {
    ...config,
    credentials: maskGatewayCredentials(config),
    credentialsEnc: undefined,
    credentialsIv: undefined,
    credentialsTag: undefined,
  }
}

function normalizeDomain(value: string) {
  return String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "")
}

function isMasked(value: unknown) {
  return typeof value === "string" && /^[•*]+$/.test(value)
}

function mergeCredentials(existing: any, incoming: unknown) {
  const previous = decryptGatewayCredentials(existing || {})
  if (!incoming || typeof incoming !== "object") return {}
  const next = { ...previous }
  for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
    if (value === "" || value == null || isMasked(value)) continue
    next[key] = value
  }
  return encryptGatewayCredentials(next)
}

async function validateGatewayInput(domain: any, body: any, existing: any) {
  const gateway = String(body.gateway || existing?.gateway || "").toLowerCase()
  const enabled = Boolean(body.enabled)
  const approvedPaymentDomain = normalizeDomain(body.approvedPaymentDomain || existing?.approvedPaymentDomain || domain.domain)
  const webhookUrl = String(body.webhookUrl || existing?.webhookUrl || "")
  const primary = await getPrimaryPaymentDomain()
  const primaryDomain = normalizePaymentDomain(primary?.domain || domain.domain)
  if (!["cashfree", "phonepe", "manual", "wallet"].includes(gateway)) return "Unsupported gateway."
  if (enabled && body.environment === "production" && webhookUrl && !webhookUrl.startsWith("https://")) return "Production webhook URL must use HTTPS."
  if (approvedPaymentDomain !== primaryDomain) return `Approved payment domain must match the primary platform domain (${primaryDomain}).`
  return null
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManagePaymentGateways(admin.role)) return unauthorized()
  const { id } = await params
  const gateways = await prisma.domainGatewayConfig.findMany({ where: { domainId: id }, orderBy: { priority: "asc" } })
  return NextResponse.json({ ok: true, gateways: gateways.map(serialize) })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManagePaymentGateways(admin.role)) return unauthorized()
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const gateway = String(body.gateway || "").toLowerCase()
  if (!["cashfree", "phonepe", "manual", "wallet"].includes(gateway)) {
    return NextResponse.json({ ok: false, code: "GATEWAY_INVALID", error: "Unsupported gateway." }, { status: 400 })
  }
  const domain = await prisma.domainConfig.findUnique({ where: { id } })
  if (!domain) return NextResponse.json({ ok: false, code: "DOMAIN_NOT_FOUND", error: "Domain not found." }, { status: 404 })
  const environment = String(body.environment || "production")
  const existing = await prisma.domainGatewayConfig.findUnique({
    where: { domainId_gateway_environment: { domainId: id, gateway, environment } },
  }).catch(() => null)
  const validation = await validateGatewayInput(domain, body, existing)
  if (validation) return NextResponse.json({ ok: false, code: "GATEWAY_INVALID", error: validation }, { status: 400 })
  const primary = await getPrimaryPaymentDomain()
  const primaryDomain = normalizePaymentDomain(primary?.domain || domain.domain)
  const credentials = mergeCredentials(existing, body.credentials)
  const config = await prisma.domainGatewayConfig.upsert({
    where: { domainId_gateway_environment: { domainId: id, gateway, environment } },
    update: {
      enabled: Boolean(body.enabled),
      priority: Number(body.priority || 100),
      displayName: body.displayName ? String(body.displayName) : null,
      approvedPaymentDomain: primaryDomain,
      webhookUrl: body.webhookUrl ? String(body.webhookUrl) : null,
      returnUrl: body.returnUrl ? String(body.returnUrl) : null,
      startUrl: body.startUrl ? String(body.startUrl) : null,
      extraConfig: body.extraConfig && typeof body.extraConfig === "object" ? body.extraConfig : {},
      ...credentials,
    },
    create: {
      domainId: id,
      gateway,
      enabled: Boolean(body.enabled),
      priority: Number(body.priority || 100),
      environment,
      displayName: body.displayName ? String(body.displayName) : null,
      approvedPaymentDomain: primaryDomain,
      webhookUrl: body.webhookUrl ? String(body.webhookUrl) : null,
      returnUrl: body.returnUrl ? String(body.returnUrl) : null,
      startUrl: body.startUrl ? String(body.startUrl) : null,
      extraConfig: body.extraConfig && typeof body.extraConfig === "object" ? body.extraConfig : {},
      ...credentials,
    },
  })
  revalidatePaymentGateways()
  await createPanelLog({
    category: "Admin Action",
    message: Boolean(body.enabled) ? "gateway_enabled" : "gateway_disabled",
    actorType: "admin",
    actorEmail: String(admin.email),
    metadata: { domainId: id, gateway },
  }).catch(() => null)
  return NextResponse.json({ ok: true, gateway: serialize(config) })
}
