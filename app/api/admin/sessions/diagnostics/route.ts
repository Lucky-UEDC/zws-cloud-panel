import { NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { getSessionDiagnostics } from "@/lib/auth/session-store"
import { canAccessAdminApi } from "@/lib/admin-rbac"

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }
  const diagnostics = await getSessionDiagnostics()
  return NextResponse.json({ ok: true, diagnostics })
}
