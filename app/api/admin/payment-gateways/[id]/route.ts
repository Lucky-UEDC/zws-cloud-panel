import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManagePaymentGateways } from "@/lib/admin-rbac"
import { requireSensitiveAdminMfa } from "@/lib/admin-sensitive-action"
import { createPanelLog } from "@/lib/panel-log"
import { getPrimaryDomainForGatewayAdmin } from "@/lib/payments/payment-gateway-admin"
import { saveAdminPaymentGatewayById } from "@/lib/payments/payment-gateway-admin-service"

function forbidden() {
  return NextResponse.json({ ok: false, code: "forbidden", message: "You do not have permission to manage payment gateways." }, { status: 403 })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManagePaymentGateways(admin.role)) return forbidden()
  const stepUp = await requireSensitiveAdminMfa(request)
  if (!stepUp.ok) return stepUp.response
  const { id } = await params
  const body = await request.json().catch(() => ({}))
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
      validationCode: result.validation.validation.code,
    },
  }).catch(() => null)
  return NextResponse.json({ ok: true, gateway: result.gateway, validation: result.validation.validation, readiness: result.readiness })
}
