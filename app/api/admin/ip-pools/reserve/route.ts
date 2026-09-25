import { NextRequest, NextResponse } from "next/server"
import { allocateIp } from "@/lib/ip-pool"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const allocation = await allocateIp({
      proxmoxNodeId: body.proxmoxNodeId || null,
      requestedIp: body.ipAddress || null,
      vmid: body.vmid ? Number(body.vmid) : null,
      hostname: body.hostname ? String(body.hostname) : null,
      assignedBy: String(admin.email),
    })
    return NextResponse.json({ success: true, allocation })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Reserve failed" }, { status: 400 })
  }
}
