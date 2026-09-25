import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"

const DEPRECATED_HEADERS = {
  "X-ZWS-Deprecated": "true",
  "X-ZWS-Replacement": "/api/admin/vms/:id",
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: DEPRECATED_HEADERS })
  }
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const consoleEnabled = Boolean(body.consoleEnabled)
  const vps = await prisma.vpsInstance.update({
    where: { id },
    data: { consoleEnabled },
    select: { id: true, consoleEnabled: true },
  })
  return NextResponse.json({
    success: true,
    vps,
    deprecated: { route: "/api/admin/vps/[id]/console", replacement: "/api/admin/vms/[id]" },
  }, { headers: DEPRECATED_HEADERS })
}
