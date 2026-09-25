import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { buildSupportCode, safeApiErrorMessage } from "@/lib/api-error-safe"
import { getAdminFromCookies } from "@/lib/server-auth"
import { requireSensitiveAdminMfa } from "@/lib/admin-sensitive-action"
import { getVmDeletionPreflight, requestVmDeletion } from "@/lib/vm-deletion"
import { sessionExpiredJson } from "@/lib/auth/session-expired-response"

export const dynamic = "force-dynamic"

async function handle(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return sessionExpiredJson()

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const stepUp = await requireSensitiveAdminMfa(request)
    if (!stepUp.ok) return stepUp.response
    const result = await requestVmDeletion({
      vpsId: id,
      actorEmail: String(admin.email),
      reason: typeof body.reason === "string" ? body.reason : "admin_delete",
      mode: "delete_vm",
    })
    const status = String((result as any)?.status || "")
    return NextResponse.json({
      success: status === "deleted" || status === "delete_pending" || Boolean((result as any)?.success),
      code: status === "delete_pending" ? "delete_pending" : "deleted",
      result,
    }, { status: status === "delete_pending" ? 202 : 200 })
  } catch (error: any) {
    const supportCode = buildSupportCode("VM-DEL")
    return NextResponse.json({
      success: false,
      error: safeApiErrorMessage(error, "VM deletion failed"),
      code: "vm_delete_failed",
      supportCode,
    }, { status: 400 })
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handle(request, context)
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handle(request, context)
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return sessionExpiredJson()
  try {
    const { id } = await params
    const preflight = await getVmDeletionPreflight(id)
    return NextResponse.json({ success: true, preflight })
  } catch (error: any) {
    const supportCode = buildSupportCode("VM-DEL-PRE")
    return NextResponse.json({
      success: false,
      error: safeApiErrorMessage(error, "VM deletion preflight failed"),
      code: "vm_delete_preflight_failed",
      supportCode,
    }, { status: 400 })
  }
}
