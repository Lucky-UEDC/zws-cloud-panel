import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { DEDICATED_REFUNDED, updateDedicatedStatus } from "@/lib/dedicated"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const service = await updateDedicatedStatus(id, DEDICATED_REFUNDED, `admin:${admin.email}`, { reason: String(body.reason || "") })
  return NextResponse.json({ success: true, service })
}
