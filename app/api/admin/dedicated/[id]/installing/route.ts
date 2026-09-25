import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { DEDICATED_INSTALLING, updateDedicatedStatus } from "@/lib/dedicated"

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const service = await updateDedicatedStatus(id, DEDICATED_INSTALLING, `admin:${admin.email}`)
  return NextResponse.json({ success: true, service })
}
