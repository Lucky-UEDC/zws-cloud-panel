import { NextResponse } from "next/server"
import { canManagePaymentGateways } from "@/lib/admin-rbac"
import { getAdminFromCookies } from "@/lib/server-auth"
import { latestEnterprisePaymentDiagnostics, runEnterprisePaymentDiagnostics } from "@/lib/payments/diagnostics"

async function authorized() {
  const admin = await getAdminFromCookies()
  return admin?.email && canManagePaymentGateways(admin.role) ? admin : null
}

export async function GET() {
  const admin = await authorized()
  if (!admin) return NextResponse.json({ success: false, code: "unauthorized", error: "Unauthorized" }, { status: 401 })
  return NextResponse.json({ success: true, run: await latestEnterprisePaymentDiagnostics() })
}

export async function POST() {
  const admin = await authorized()
  if (!admin) return NextResponse.json({ success: false, code: "unauthorized", error: "Unauthorized" }, { status: 401 })
  const run = await runEnterprisePaymentDiagnostics({ requestedBy: admin.email, trigger: "admin", runLiveAuth: true })
  return NextResponse.json({ success: run.status !== "failed", run }, { status: run.status === "failed" ? 503 : 200 })
}
