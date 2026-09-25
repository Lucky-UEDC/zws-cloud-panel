import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { repairPaidGatewayPayments } from "@/lib/payment-repair"
import { canAccessAdminApi } from "@/lib/admin-rbac"

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const body = await request.json().catch(() => ({}))
  const result = await repairPaidGatewayPayments({
    actor: `admin:${admin.email}`,
    limit: Number(body.limit || 50),
    dryRun: Boolean(body.dryRun),
  })
  return NextResponse.json({ success: true, result })
}
