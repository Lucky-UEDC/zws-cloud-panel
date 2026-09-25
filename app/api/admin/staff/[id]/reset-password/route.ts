import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db"
import { createAuditLog } from "@/lib/audit-log"
import { revokeSessionsForUser } from "@/lib/auth/session-store"
import { canManageAdminAccounts } from "@/lib/admin-rbac-server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { requireSensitiveAdminMfa } from "@/lib/admin-sensitive-action"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !(await canManageAdminAccounts(admin.sub, admin.role))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const stepUp = await requireSensitiveAdminMfa(request)
  if (!stepUp.ok) return stepUp.response

  const { id } = await params
  const body = await request.json()
  const password = String(body.password || "")
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 })
  }

  const target = await prisma.adminProfile.findUnique({ where: { id }, select: { id: true, email: true } })
  if (!target) {
    return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
  }

  const hashedPassword = await bcrypt.hash(password, 10)
  await prisma.adminProfile.update({ where: { id }, data: { hashedPassword } })
  await revokeSessionsForUser(id).catch(() => undefined)
  await createAuditLog({
    action: "admin.staff.password_reset",
    adminId: admin.sub || null,
    actorEmail: admin.email,
    targetType: "admin_profile",
    targetId: id,
    metadata: { targetEmail: target.email },
  })

  return NextResponse.json({ success: true })
}
