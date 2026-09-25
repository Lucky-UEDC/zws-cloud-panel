import { NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { deleteBackupRun } from "@/lib/backups"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { getAdminFromCookies } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  try {
    return NextResponse.json({ success: true, result: await deleteBackupRun(id) }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Unable to delete backup." }, { status: error?.status || 500, headers: NO_CACHE_HEADERS })
  }
}
