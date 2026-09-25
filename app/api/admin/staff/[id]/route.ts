import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManageAdminAccounts, ensureSystemRbac } from "@/lib/admin-rbac-server"
import { normalizeStaffRole } from "@/lib/roles"
import { createAuditLog } from "@/lib/audit-log"
import { revokeSessionsForUser } from "@/lib/auth/session-store"
import { requireSensitiveAdminMfa } from "@/lib/admin-sensitive-action"

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !(await canManageAdminAccounts(admin.sub, admin.role))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const stepUp = await requireSensitiveAdminMfa(request)
  if (!stepUp.ok) return stepUp.response

  await ensureSystemRbac()
  const { id } = await params
  const body = await request.json()

  const current = await prisma.adminProfile.findUnique({ where: { id } })
  if (!current) {
    return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
  }

  const nextRole = typeof body.role === "string" ? normalizeStaffRole(body.role) || undefined : undefined
  const role = typeof body.roleId === "string" && body.roleId
    ? await prisma.role.findUnique({ where: { id: body.roleId } })
    : nextRole
      ? await prisma.role.findUnique({ where: { slug: nextRole === "seo_agent" ? "blog_writer" : nextRole } })
      : null

  const updated = await prisma.adminProfile.update({
    where: { id },
    data: {
      isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
      role: role ? normalizeStaffRole(role.slug) || "support_agent" : nextRole,
      roleId: role?.id,
      displayName: typeof body.displayName === "string" ? body.displayName.trim() : undefined,
    },
  })

  if ((role && role.id !== current.roleId) || (typeof body.isActive === "boolean" && body.isActive !== current.isActive)) {
    await revokeSessionsForUser(id).catch(() => undefined)
  }

  await createAuditLog({
    action: "admin.staff.updated",
    adminId: admin.sub || null,
    actorEmail: admin.email,
    targetType: "admin_profile",
    targetId: id,
    oldValue: { role: current.role, roleId: current.roleId, isActive: current.isActive, displayName: current.displayName },
    newValue: { role: updated.role, roleId: updated.roleId, isActive: updated.isActive, displayName: updated.displayName },
  })

  return NextResponse.json({ success: true, staff: updated })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !(await canManageAdminAccounts(admin.sub, admin.role))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const stepUp = await requireSensitiveAdminMfa(request)
  if (!stepUp.ok) return stepUp.response

  const { id } = await params
  if (admin.sub === id) {
    return NextResponse.json({ error: "You cannot delete your own admin account" }, { status: 400 })
  }

  const current = await prisma.adminProfile.findUnique({ where: { id } })
  if (!current) {
    return NextResponse.json({ error: "Staff member not found" }, { status: 404 })
  }

  await prisma.adminProfile.delete({ where: { id } })
  await revokeSessionsForUser(id).catch(() => undefined)
  await createAuditLog({
    action: "admin.staff.deleted",
    adminId: admin.sub || null,
    actorEmail: admin.email,
    targetType: "admin_profile",
    targetId: id,
    oldValue: { email: current.email, role: current.role, roleId: current.roleId },
  })

  return NextResponse.json({ success: true })
}
