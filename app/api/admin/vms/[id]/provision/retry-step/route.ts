import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { retryFailedProvisionStep } from "@/lib/admin-vm-management"
import { buildSupportCode, safeApiErrorMessage } from "@/lib/api-error-safe"
import { canAccessAdminApi } from "@/lib/admin-rbac"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const result = await retryFailedProvisionStep({
      vpsId: id,
      actorEmail: String(admin.email),
      reason: body.reason ? String(body.reason) : null,
    })
    return NextResponse.json({ success: true, result })
  } catch (error: any) {
    const supportCode = buildSupportCode("VM-RETRY")
    return NextResponse.json({ success: false, error: safeApiErrorMessage(error, "Retry failed"), supportCode }, { status: 400 })
  }
}
