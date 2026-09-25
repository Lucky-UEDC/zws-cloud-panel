import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { deliverDedicatedService } from "@/lib/dedicated"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const primaryIp = String(body.primaryIp || "").trim()
  const username = String(body.username || "").trim()
  const password = String(body.password || "")
  if (!primaryIp || !username || !password) {
    return NextResponse.json({ success: false, error: "Primary IP, username, and password are required." }, { status: 400 })
  }
  const service = await deliverDedicatedService(id, {
    primaryIp,
    username,
    password,
    panelUrl: body.panelUrl ? String(body.panelUrl).trim() : null,
    notes: body.notes ? String(body.notes).trim() : null,
    installedOs: body.installedOs ? String(body.installedOs).trim() : null,
    actor: `admin:${admin.email}`,
  })
  return NextResponse.json({ success: true, service })
}
