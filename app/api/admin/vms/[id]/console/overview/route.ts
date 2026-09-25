import { NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { getConsoleOverview } from "@/lib/console-overview"
import { getAdminFromCookies } from "@/lib/server-auth"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await params
  const overview = await getConsoleOverview(id, { type: "admin", adminEmail: admin.email })
  if (!overview) return NextResponse.json({ success: false, error: "Instance not found" }, { status: 404 })
  return NextResponse.json(overview, { headers: { "Cache-Control": "no-store" } })
}
