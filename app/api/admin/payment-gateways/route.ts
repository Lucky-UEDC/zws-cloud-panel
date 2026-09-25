import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManagePaymentGateways } from "@/lib/admin-rbac"
import { createPanelLog } from "@/lib/panel-log"
import { getBaseUrl } from "@/lib/runtime-site-url"
import { requireSensitiveAdminMfa } from "@/lib/admin-sensitive-action"
import {
  ADMIN_PAYMENT_GATEWAYS,
  ensureAdminPaymentGateways,
  getPrimaryDomainForGatewayAdmin,
  serializePaymentGateway,
} from "@/lib/payments/payment-gateway-admin"
import { saveAdminPaymentGatewayById } from "@/lib/payments/payment-gateway-admin-service"

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
}

export async function GET(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManagePaymentGateways(admin.role)) return unauthorized()
  await ensureAdminPaymentGateways()
  const [gateways, primaryDomain] = await Promise.all([
    (prisma as any).paymentGateway.findMany({
      where: {
        OR: [...ADMIN_PAYMENT_GATEWAYS.map((code) => ({ code })), ...ADMIN_PAYMENT_GATEWAYS.map((provider) => ({ provider }))],
      },
      orderBy: [{ priority: "asc" }, { provider: "asc" }],
    }).catch(() => []),
    getPrimaryDomainForGatewayAdmin().catch(() => null),
  ])
  const byCode = new Map<string, any>()
  for (const gateway of gateways) {
    const code = String(gateway.code || gateway.provider || "").toLowerCase()
    if (!byCode.has(code)) byCode.set(code, gateway)
  }
  const baseUrl = getBaseUrl(request)
  return NextResponse.json({
    ok: true,
    primaryDomain,
    gateways: ADMIN_PAYMENT_GATEWAYS.map((code) => byCode.get(code)).filter(Boolean).map((row) => serializePaymentGateway(row, primaryDomain, baseUrl)),
  })
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManagePaymentGateways(admin.role)) return unauthorized()
  const stepUp = await requireSensitiveAdminMfa(request)
  if (!stepUp.ok) return stepUp.response
  await ensureAdminPaymentGateways()
  const body = await request.json().catch(() => ({}))
  const id = String(body.id || "").trim()
  if (!id) {
    return NextResponse.json({
      ok: false,
      code: "gateway_id_required",
      message: "Saving a payment gateway requires the gateway ID. Use PATCH /api/admin/payment-gateways/{id}.",
    }, { status: 400 })
  }
  const primaryDomain = await getPrimaryDomainForGatewayAdmin().catch(() => null)
  const result = await saveAdminPaymentGatewayById({ id, body, request, primaryDomain })
  if (!result.ok) return NextResponse.json(result.error, { status: result.status })
  await createPanelLog({
    category: "PAYMENT",
    message: "payment_gateway_saved",
    actorType: "admin",
    actorEmail: String(admin.email),
    metadata: {
      gatewayId: result.row.id,
      provider: result.row.provider,
      mode: result.row.mode,
      enabled: result.row.enabled,
      priority: result.row.priority,
      failsafeEnabled: result.row.failsafeEnabled,
      validationCode: result.validation.validation.code,
    },
  }).catch(() => null)
  return NextResponse.json({
    ok: true,
    gateway: result.gateway,
    validation: result.validation.validation,
    readiness: result.readiness,
  })
}
