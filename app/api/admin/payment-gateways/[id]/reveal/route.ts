import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManagePaymentGateways } from "@/lib/admin-rbac"
import { requireSensitiveAdminMfa } from "@/lib/admin-sensitive-action"
import { createPanelLog } from "@/lib/panel-log"
import { revealAdminGatewayCredential } from "@/lib/payments/payment-gateway-admin-service"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManagePaymentGateways(admin.role)) {
    return NextResponse.json({ ok: false, code: "forbidden", message: "You do not have permission to manage payment gateways." }, { status: 403 })
  }
  const stepUp = await requireSensitiveAdminMfa(request)
  if (!stepUp.ok) {
    if ("response" in stepUp && stepUp.response) {
      return stepUp.response
    }
    return NextResponse.json({ ok: false, code: "mfa_required", message: "MFA verification is required to reveal gateway credentials." }, { status: 401 })
  }
  const { id } = await params
  const gateway = await (prisma as any).paymentGateway.findUnique({ where: { id } }).catch(() => null)
  if (!gateway) {
    return NextResponse.json({ ok: false, code: "gateway_not_found", message: "Payment gateway not found.", gatewayId: id }, { status: 404 })
  }
  const body = await request.json().catch(() => null)
  const field = String(body?.field || "").trim()
  if (!field) {
    return NextResponse.json({ ok: false, code: "field_required", message: "Credential field is required." }, { status: 400 })
  }
  const result = await revealAdminGatewayCredential(gateway, field)
  if (!result.ok) {
    return NextResponse.json({ ...result }, { status: 400 })
  }
  if (result.secret) {
    void createPanelLog({
      level: "info",
      category: "PAYMENT",
      message: "payment_gateway_credential_revealed",
      actorType: "admin",
      actorEmail: admin.email,
      metadata: { gateway: result.code, field: result.field, gatewayId: id },
    }).catch(() => null)
  }
  return NextResponse.json({ ok: true, gateway, code: result.code, field: result.field, value: result.value, secret: result.secret })
}