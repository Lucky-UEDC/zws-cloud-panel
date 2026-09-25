import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManagePaymentGateways } from "@/lib/admin-rbac"
import { createPanelLog } from "@/lib/panel-log"
import { maskGatewayCredentials } from "@/lib/payments/domain-gateway-credentials"

function unauthorized() {
  return NextResponse.json({ ok: false, code: "ADMIN_UNAUTHORIZED", error: "Your admin session expired. Please sign in again." }, { status: 401 })
}

function normalizeDomain(value: string) {
  return String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "")
}

function serializeDomain(domain: any) {
  return {
    ...domain,
    gatewayConfigs: (domain.gatewayConfigs || []).map((config: any) => ({
      ...config,
      credentials: maskGatewayCredentials(config),
      credentialsEnc: undefined,
      credentialsIv: undefined,
      credentialsTag: undefined,
    })),
  }
}

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManagePaymentGateways(admin.role)) return unauthorized()
  const domains = await prisma.domainConfig.findMany({
    orderBy: [{ isPrimary: "desc" }, { domain: "asc" }],
    include: { gatewayConfigs: { orderBy: { priority: "asc" } } },
  })
  return NextResponse.json({ ok: true, domains: domains.map(serializeDomain) })
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManagePaymentGateways(admin.role)) return unauthorized()
  const body = await request.json().catch(() => ({}))
  const domain = normalizeDomain(body.domain)
  if (!domain) return NextResponse.json({ ok: false, code: "DOMAIN_INVALID", error: "Domain is required." }, { status: 400 })
  if (String(body.appBaseUrl || `https://${domain}`).replace(/\/$/, "").startsWith("http://") && String(body.environmentMode || "production") === "production") {
    return NextResponse.json({ ok: false, code: "DOMAIN_INVALID", error: "Production app base URL must use HTTPS." }, { status: 400 })
  }
  if (Boolean(body.isPrimary) && body.isActive === false) {
    return NextResponse.json({ ok: false, code: "DOMAIN_INVALID", error: "Primary domain must be active." }, { status: 400 })
  }
  if (Boolean(body.isPrimary)) {
    await prisma.domainConfig.updateMany({ where: { isPrimary: true }, data: { isPrimary: false } })
  }

  const created = await prisma.domainConfig.create({
    data: {
      domain,
      displayName: String(body.displayName || domain),
      brandName: body.brandName ? String(body.brandName) : null,
      appBaseUrl: String(body.appBaseUrl || `https://${domain}`).replace(/\/$/, ""),
      isPrimary: Boolean(body.isPrimary),
      isActive: body.isActive !== false,
      canonicalRedirectEnabled: Boolean(body.canonicalRedirectEnabled),
      allowedGatewayModes: Array.isArray(body.allowedGatewayModes) ? body.allowedGatewayModes : [],
      defaultGateway: body.defaultGateway ? String(body.defaultGateway) : null,
      fallbackGateway: body.fallbackGateway ? String(body.fallbackGateway) : null,
      environmentMode: String(body.environmentMode || "production"),
      metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
      notes: body.notes ? String(body.notes) : null,
    },
    include: { gatewayConfigs: true },
  })
  await createPanelLog({
    category: "Admin Action",
    message: "domain_created",
    actorType: "admin",
    actorEmail: String(admin.email),
    metadata: { domain },
  }).catch(() => null)
  return NextResponse.json({ ok: true, domain: serializeDomain(created) })
}
