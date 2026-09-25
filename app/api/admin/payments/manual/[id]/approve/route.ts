import { NextResponse } from "next/server"
import { canManagePaymentGateways } from "@/lib/admin-rbac"
import { getAdminFromCookies } from "@/lib/server-auth"
import { approveManualPayment } from "@/lib/payments/manual-payments"

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManagePaymentGateways(admin.role)) return NextResponse.json({ success: false, code: "unauthorized", error: "Unauthorized" }, { status: 401 })
  try { const { id } = await params; const result = await approveManualPayment({ requestId: id, approvedBy: String(admin.email) }); return NextResponse.json({ success: true, code: "manual_payment_approved", result }) }
  catch (error: any) { return NextResponse.json({ success: false, code: error?.code || "manual_payment_approval_failed", error: error?.message || "Manual payment approval failed." }, { status: 409 }) }
}
