import crypto from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { canManagePaymentGateways } from "@/lib/admin-rbac"
import { getAdminFromCookies } from "@/lib/server-auth"
import { importGatewaySettlement } from "@/lib/payments/revenue-engine"

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManagePaymentGateways(admin.role)) return NextResponse.json({ success: false, code: "unauthorized", error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  try {
    const normalized = { gateway: String(body.gateway || "").toLowerCase(), reference: String(body.reference || ""), currency: String(body.currency || "INR").toUpperCase(), grossAmount: Number(body.grossAmount), feeAmount: Number(body.feeAmount || 0), taxAmount: Number(body.taxAmount || 0), netAmount: Number(body.netAmount), settledAt: new Date(body.settledAt) }
    if (!normalized.gateway || !normalized.reference || !Number.isFinite(normalized.grossAmount) || !Number.isFinite(normalized.netAmount) || Number.isNaN(normalized.settledAt.getTime())) throw Object.assign(new Error("Settlement fields are incomplete or invalid."), { code: "invalid_settlement" })
    const sourceHash = crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex")
    const settlement = await importGatewaySettlement({ ...normalized, sourceHash, metadata: { importedBy: admin.email } })
    return NextResponse.json({ success: true, settlement })
  } catch (error: any) { return NextResponse.json({ success: false, code: error?.code || "settlement_import_failed", error: error?.message || "Settlement import failed." }, { status: 409 }) }
}
