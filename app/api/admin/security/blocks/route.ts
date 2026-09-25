import { NextRequest, NextResponse } from "next/server"
import { requireAdminFullAuth } from "@/lib/auth/guards"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { prisma } from "@/lib/db"

export async function GET(request: NextRequest) {
  const auth = await requireAdminFullAuth(request)
  if (!auth.ok) return auth.response
  if (!canAccessAdminApi(auth.session.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const activeOnly = request.nextUrl.searchParams.get("active") !== "0"
  const where = activeOnly ? { unblockedAt: null } : {}
  const [ips, devices] = await Promise.all([
    (prisma as any).blockedIp.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 }).catch(() => []),
    (prisma as any).blockedDevice.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 }).catch(() => []),
  ])

  return NextResponse.json({ ips, devices })
}
