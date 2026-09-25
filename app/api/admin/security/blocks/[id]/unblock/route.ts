import { NextRequest, NextResponse } from "next/server"
import { requireAdminFullAuth, requireSameOriginOrCsrf } from "@/lib/auth/guards"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { prisma } from "@/lib/db"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminFullAuth(request)
  if (!auth.ok) return auth.response
  if (!canAccessAdminApi(auth.session.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const origin = await requireSameOriginOrCsrf(request)
  if (!origin.ok) return origin.response

  const { id } = await params
  const now = new Date()
  const [ipResult, deviceResult] = await Promise.all([
    (prisma as any).blockedIp.updateMany({ where: { id, unblockedAt: null }, data: { unblockedAt: now, unblockedBy: auth.session.email } }).catch(() => ({ count: 0 })),
    (prisma as any).blockedDevice.updateMany({ where: { id, unblockedAt: null }, data: { unblockedAt: now, unblockedBy: auth.session.email } }).catch(() => ({ count: 0 })),
  ])
  if (!ipResult.count && !deviceResult.count) return NextResponse.json({ error: "Block not found" }, { status: 404 })
  return NextResponse.json({ success: true })
}
