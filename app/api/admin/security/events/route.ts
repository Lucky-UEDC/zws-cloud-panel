import { NextRequest, NextResponse } from "next/server"
import { requireAdminFullAuth } from "@/lib/auth/guards"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { prisma } from "@/lib/db"

export async function GET(request: NextRequest) {
  const auth = await requireAdminFullAuth(request)
  if (!auth.ok) return auth.response
  if (!canAccessAdminApi(auth.session.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const type = request.nextUrl.searchParams.get("type") || undefined
  const severity = request.nextUrl.searchParams.get("severity") || undefined
  const [events, attacks, failed, suspicious] = await Promise.all([
    (prisma as any).securityEvent.findMany({
      where: { eventType: type, severity },
      orderBy: { createdAt: "desc" },
      take: 100,
    }).catch(() => []),
    (prisma as any).attackLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    }).catch(() => []),
    (prisma as any).failedAttempt.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    }).catch(() => []),
    (prisma as any).suspiciousRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    }).catch(() => []),
  ])

  return NextResponse.json({ events, attacks, failed, suspicious })
}
