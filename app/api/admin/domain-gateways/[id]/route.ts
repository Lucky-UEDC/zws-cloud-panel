import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManagePaymentGateways } from "@/lib/admin-rbac"
import { createPanelLog } from "@/lib/panel-log"
import { decryptGatewayCredentials, encryptGatewayCredentials, maskGatewayCredentials } from "@/lib/payments/domain-gateway-credentials"
import { revalidatePaymentGateways } from "@/lib/payments/runtime-payment-config"

function unauthorized() {
  return NextResponse.json({ ok: false, code: "ADMIN_UNAUTHORIZED", error: "Your admin session expired. Please sign in again." }, { status: 401 })
}

function isMasked(value: unknown) {
  return typeof value === "string" && /^[•*]+$/.test(value)
}

function mergeCredentials(existing: any, incoming: unknown) {
  if (!incoming || typeof incoming !== "object") return {}
  const previous = decryptGatewayCredentials(existing || {})
  const next = { ...previous }
  for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
    if (value === "" || value == null || isMasked(value)) continue
    next[key] = value
  }
  return encryptGatewayCredentials(next)
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManagePaymentGateways(admin.role)) return unauthorized()
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const existing = await prisma.domainGatewayConfig.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ ok: false, code: "GATEWAY_NOT_FOUND", error: "Gateway config not found." }, { status: 404 })
  const credentials = mergeCredentials(existing, body.credentials)
  const patch: Record<string, any> = { ...credentials }
  for (const key of ["enabled"]) if (key in body) patch[key] = Boolean(body[key])
  for (const key of ["priority"]) if (key in body) patch[key] = Number(body[key] || 100)
  for (const key of ["environment", "displayName", "approvedPaymentDomain", "webhookUrl", "returnUrl", "startUrl"]) {
    if (key in body) patch[key] = body[key] === "" ? null : String(body[key])
  }
  if (body.extraConfig && typeof body.extraConfig === "object") patch.extraConfig = body.extraConfig
  const config = await prisma.domainGatewayConfig.update({ where: { id }, data: patch })
  revalidatePaymentGateways()
  await createPanelLog({
    category: "Admin Action",
    message: "gateway_config_updated",
    actorType: "admin",
    actorEmail: String(admin.email),
    metadata: { gatewayConfigId: id, gateway: config.gateway },
  }).catch(() => null)
  return NextResponse.json({
    ok: true,
    gateway: {
      ...config,
      credentials: maskGatewayCredentials(config),
      credentialsEnc: undefined,
      credentialsIv: undefined,
      credentialsTag: undefined,
    },
  })
}
