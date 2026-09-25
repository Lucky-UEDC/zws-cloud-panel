import { NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { relinkVmByOrderIdentity } from "@/lib/admin-vm-management"
import { buildSupportCode, safeApiErrorMessage } from "@/lib/api-error-safe"
import { canAccessAdminApi } from "@/lib/admin-rbac"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { id } = await params
    const result = await relinkVmByOrderIdentity({
      vpsId: id,
      actorEmail: String(admin.email),
    })
    return NextResponse.json({ success: true, result })
  } catch (error: any) {
    const supportCode = buildSupportCode("VM-RELINK-ONE")
    return NextResponse.json({ success: false, error: safeApiErrorMessage(error, "VM relink failed"), supportCode }, { status: 400 })
  }
}
