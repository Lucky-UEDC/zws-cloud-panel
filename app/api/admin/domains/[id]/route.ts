import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManagePaymentGateways } from "@/lib/admin-rbac"
import { createPanelLog } from "@/lib/panel-log"

function unauthorized() {
  return NextResponse.json({ ok: false, code: "ADMIN_UNAUTHORIZED", error: "Your admin session expired. Please sign in again." }, { status: 401 })
}

function normalizeDomain(value: string) {
  return String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "")
}

async function validateDomainPatch(id: string, patch: Record<string, any>) {
  const existing = await prisma.domainConfig.findUnique({ where: { id }, include: { gatewayConfigs: true } })
  if (!existing) return "Domain not found."
  const next = { ...existing, ...patch }
  if (next.domain && /^https?:\/\//.test(String(next.domain))) return "Domain must not include protocol."
  if (next.environmentMode === "production" && next.appBaseUrl && !String(next.appBaseUrl).startsWith("https://")) return "Production app base URL must use HTTPS."
  if (next.isPrimary && !next.isActive) return "Primary domain must be active."
  if (next.defaultGateway && next.defaultGateway !== "none") {
    const config = existing.gatewayConfigs.find((item) => item.gateway === next.defaultGateway && item.enabled)
    if (!config) return "Default gateway must be enabled for this domain."
  }
  if (next.fallbackGateway && next.fallbackGateway !== "none" && next.fallbackGateway === next.defaultGateway) return "Fallback gateway cannot equal default gateway."
  if (next.fallbackGateway && next.fallbackGateway !== "none") {
    const config = existing.gatewayConfigs.find((item) => item.gateway === next.fallbackGateway && item.enabled)
    if (!config) return "Fallback gateway must be enabled for this domain."
  }
  return null
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManagePaymentGateways(admin.role)) return unauthorized()
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const patch: Record<string, any> = {}
  if (typeof body.domain === "string") patch.domain = normalizeDomain(body.domain)
  for (const key of ["displayName", "brandName", "appBaseUrl", "defaultGateway", "fallbackGateway", "environmentMode", "notes"]) {
    if (key in body) patch[key] = body[key] === "" || body[key] === "none" ? null : String(body[key])
  }
  for (const key of ["isPrimary", "isActive", "canonicalRedirectEnabled"]) {
    if (key in body) patch[key] = Boolean(body[key])
  }
  if (Array.isArray(body.allowedGatewayModes)) patch.allowedGatewayModes = body.allowedGatewayModes
	  if (body.metadata && typeof body.metadata === "object") patch.metadata = body.metadata
  if (body.fallbackBehavior) {
    const existing = await prisma.domainConfig.findUnique({ where: { id }, select: { metadata: true } })
    const metadata = existing?.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata) ? existing.metadata as Record<string, any> : {}
    patch.metadata = {
      ...metadata,
      ...(patch.metadata && typeof patch.metadata === "object" ? patch.metadata : {}),
      paymentRouting: {
        ...((metadata.paymentRouting && typeof metadata.paymentRouting === "object") ? metadata.paymentRouting : {}),
        fallbackBehavior: String(body.fallbackBehavior),
      },
    }
  }
	  const validation = await validateDomainPatch(id, patch)
	  if (validation) return NextResponse.json({ ok: false, code: "DOMAIN_INVALID", error: validation }, { status: 400 })
	  if (patch.isPrimary === true) {
	    await prisma.domainConfig.updateMany({ where: { id: { not: id }, isPrimary: true }, data: { isPrimary: false } })
	  }

	  const updated = await prisma.domainConfig.update({ where: { id }, data: patch })
  await createPanelLog({
    category: "Admin Action",
    message: "domain_updated",
    actorType: "admin",
    actorEmail: String(admin.email),
    metadata: { domainId: id, domain: updated.domain },
  }).catch(() => null)
  return NextResponse.json({ ok: true, domain: updated })
}
