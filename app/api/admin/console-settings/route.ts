import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { getSetting, upsertSetting, type ConsoleSettings } from "@/lib/settings"
import { isAdminLikeRole } from "@/lib/admin-rbac"

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json(await getSetting<ConsoleSettings>("console_settings"))
}

export async function PUT(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const saved = await upsertSetting("console_settings", body, String(admin.email))
  return NextResponse.json({ success: true, value: saved.value })
}
