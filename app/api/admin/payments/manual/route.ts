import { NextRequest, NextResponse } from "next/server"
import { canManagePaymentGateways } from "@/lib/admin-rbac"
import { getAdminFromCookies } from "@/lib/server-auth"
import { requestManualPayment } from "@/lib/payments/manual-payments"

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManagePaymentGateways(admin.role)) return NextResponse.json({ success: false, code: "unauthorized", error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  try {
    const row = await requestManualPayment({ invoiceId: String(body.invoiceId || ""), transactionReference: String(body.transactionReference || ""), method: String(body.method || ""), amount: Number(body.amount), currency: String(body.currency || "INR"), paidAt: new Date(body.paidAt || Date.now()), evidence: String(body.evidence || body.note || ""), requestedBy: String(admin.email) })
    return NextResponse.json({ success: true, code: "manual_payment_pending_approval", request: row }, { status: 202 })
  } catch (error: any) { return NextResponse.json({ success: false, code: error?.code || "manual_payment_request_failed", error: error?.message || "Manual payment request failed." }, { status: 409 }) }
}
