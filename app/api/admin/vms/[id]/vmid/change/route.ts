import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { changeVmIdSafely } from "@/lib/admin-vm-management"
import { buildSupportCode, safeApiErrorMessage } from "@/lib/api-error-safe"
import { isAdminLikeRole } from "@/lib/admin-rbac"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const targetVmid = Number(body.targetVmid)
    const reason = body.reason ? String(body.reason) : null
    const result = await changeVmIdSafely({
      vpsId: id,
      targetVmid,
      reason,
      actorEmail: String(admin.email),
    })
    return NextResponse.json({ success: true, result })
  } catch (error: any) {
    const supportCode = buildSupportCode("VM-VMID")
    return NextResponse.json({ success: false, error: safeApiErrorMessage(error, "VMID change failed"), supportCode }, { status: 400 })
  }
}
