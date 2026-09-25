import { NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { permanentlyDeleteDuplicateVm } from "@/lib/vm-duplicate-quarantine"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { safeApiErrorMessage } from "@/lib/api-error-safe"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  try {
    const { id } = await params
    const incident = await permanentlyDeleteDuplicateVm({ incidentId: id, actorEmail: String(admin.email) })
    return NextResponse.json({ success: true, incident }, { headers: NO_CACHE_HEADERS })
  } catch (error) {
    return NextResponse.json({ success: false, error: safeApiErrorMessage(error, "Duplicate cleanup failed") }, { status: 409, headers: NO_CACHE_HEADERS })
  }
}
