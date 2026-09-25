import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { buildSupportCode, safeApiErrorMessage } from "@/lib/api-error-safe"
import { sessionExpiredJson } from "@/lib/auth/session-expired-response"
import { getAdminFromCookies } from "@/lib/server-auth"
import { requireSensitiveAdminMfa } from "@/lib/admin-sensitive-action"
import { retryPendingVmDeletion } from "@/lib/vm-deletion"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return sessionExpiredJson()
  const stepUp = await requireSensitiveAdminMfa(request)
  if (!stepUp.ok) return stepUp.response

  try {
    const { id } = await params
    const result = await retryPendingVmDeletion({ vpsId: id, actorEmail: String(admin.email) })
    const status = String((result as any)?.status || "")
    return NextResponse.json({
      success: status === "deleted" || status === "delete_pending" || Boolean((result as any)?.success),
      code: status === "delete_pending" ? "delete_pending" : "deleted",
      result,
    }, { status: status === "delete_pending" ? 202 : 200 })
  } catch (error: any) {
    const supportCode = buildSupportCode("VM-DEL-RETRY")
    return NextResponse.json({
      success: false,
      error: safeApiErrorMessage(error, "VM deletion retry failed"),
      code: "vm_delete_retry_failed",
      supportCode,
    }, { status: 400 })
  }
}
