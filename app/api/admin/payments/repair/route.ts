import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { repairPaidGatewayPayments, repairStuckCashfreePayments, repairManualPaidInvoices } from "@/lib/payment-repair"
import { buildSupportCode, safeApiErrorMessage } from "@/lib/api-error-safe"
import { canAccessAdminApi } from "@/lib/admin-rbac"

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const limit = Math.max(1, Math.min(Number(body.limit || 100), 500))
    const dryRun = Boolean(body.dryRun)
    const actor = `admin:${String(admin.email)}`

    const [stuck, paid, manualPaid] = await Promise.all([
      repairStuckCashfreePayments({ actor, limit, dryRun }),
      repairPaidGatewayPayments({ actor, limit, dryRun }),
      repairManualPaidInvoices({ actor, limit, dryRun }),
    ])

    return NextResponse.json({
      success: true,
      result: {
        dryRun,
        limit,
        stuck,
        paid,
        manualPaid,
      },
    })
  } catch (error: any) {
    const supportCode = buildSupportCode("PAY-REPAIR")
    return NextResponse.json({ success: false, error: safeApiErrorMessage(error, "Repair failed"), supportCode }, { status: 400 })
  }
}
