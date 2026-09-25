import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManageAdminAccounts, ensureSystemRbac } from "@/lib/admin-rbac-server"
import { createAuditLog } from "@/lib/audit-log"
import { normalizeStaffRole } from "@/lib/roles"
import { requireSensitiveAdminMfa } from "@/lib/admin-sensitive-action"

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !(await canManageAdminAccounts(admin.sub, admin.role))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  await ensureSystemRbac()
  const staff = await prisma.adminProfile.findMany({
    orderBy: [{ isActive: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      role: true,
      roleId: true,
      roleRef: { select: { id: true, name: true, slug: true } },
      isActive: true,
      createdAt: true,
      lastLogin: true,
    },
  })

  return NextResponse.json({ staff })
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !(await canManageAdminAccounts(admin.sub, admin.role))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const stepUp = await requireSensitiveAdminMfa(request)
  if (!stepUp.ok) return stepUp.response

  await ensureSystemRbac()
  const body = await request.json()
  const email = String(body.email || "").trim().toLowerCase()
  const displayName = String(body.displayName || body.name || "").trim()
  const username = String(body.username || email.split("@")[0] || "").trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "")
  const password = String(body.password || "")
  const roleId = typeof body.roleId === "string" && body.roleId ? body.roleId : null
  const roleSlug = typeof body.role === "string" ? normalizeStaffRole(body.role) : null

  if (!email || !displayName || !username || password.length < 8) {
    return NextResponse.json({ error: "Name, email, username, and an 8+ character password are required" }, { status: 400 })
  }

  const role = roleId
    ? await prisma.role.findUnique({ where: { id: roleId } })
    : await prisma.role.findUnique({ where: { slug: roleSlug || "support_agent" } })

  if (!role) {
    return NextResponse.json({ error: "Role not found" }, { status: 400 })
  }

  const hashedPassword = await bcrypt.hash(password, 10)
  const created = await prisma.adminProfile.create({
    data: {
      email,
      username,
      displayName,
      hashedPassword,
      role: normalizeStaffRole(role.slug) || "support_agent",
      roleId: role.id,
      isActive: body.status ? String(body.status).toLowerCase() === "active" : true,
    },
    select: { id: true, email: true, username: true, displayName: true, role: true, roleId: true, isActive: true, createdAt: true },
  })

  await createAuditLog({
    action: "admin.staff.created",
    adminId: admin.sub || null,
    actorEmail: admin.email,
    targetType: "admin_profile",
    targetId: created.id,
    newValue: created,
  })

  return NextResponse.json({ success: true, staff: created }, { status: 201 })
}
