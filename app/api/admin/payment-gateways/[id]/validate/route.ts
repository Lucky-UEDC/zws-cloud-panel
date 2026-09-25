import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManagePaymentGateways } from "@/lib/admin-rbac"
import { validateAdminPaymentGateway, credentialsSnapshot } from "@/lib/payments/payment-gateway-admin-service"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManagePaymentGateways(admin.role)) {
    return NextResponse.json({ ok: false, code: "forbidden", message: "You do not have permission to manage payment gateways." }, { status: 403 })
  }
  const { id } = await params
  const gateway = await (prisma as any).paymentGateway.findUnique({ where: { id } }).catch(() => null)
  if (!gateway) return NextResponse.json({ ok: false, code: "gateway_not_found", message: "Payment gateway not found.", gatewayId: id }, { status: 404 })
  const result = await validateAdminPaymentGateway(gateway, request, { requireAuth: Boolean(gateway.enabled ?? gateway.active) })
  const snapshot = credentialsSnapshot(gateway)
  await (prisma as any).paymentGateway.update({
    where: { id },
    data: {
      lastHealthStatus: result.ok && gateway.enabled ? "healthy" : gateway.enabled ? "degraded" : "disabled",
      lastError: result.ok ? null : result.error.message,
      lastHealthCheckedAt: new Date(),
    },
  }).catch(() => null)
  if (!result.ok) {
    return NextResponse.json({ ...result.error, validation: result.validation, credentials: snapshot }, { status: 400 })
  }
  return NextResponse.json({ ok: true, validation: result.validation, auth: result.auth, credentials: snapshot, message: result.message })
}
