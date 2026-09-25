import { NextResponse } from "next/server"
import { restoreTestBackup } from "@/lib/backups"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"

export const dynamic = "force-dynamic"

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  try {
    const restore = await restoreTestBackup(id, String(admin.email))
    return NextResponse.json({ success: restore.status === "passed", restore }, { status: restore.status === "failed" ? 500 : 200 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Restore test failed" }, { status: error?.status || 500 })
  }
}
