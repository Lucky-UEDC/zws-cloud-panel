import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { createAuditLog } from "@/lib/audit-log"
import { canManageRolesDynamic, ensureSystemRbac } from "@/lib/admin-rbac-server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { requireSensitiveAdminMfa } from "@/lib/admin-sensitive-action"

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !(await canManageRolesDynamic(admin.sub, admin.role))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const stepUp = await requireSensitiveAdminMfa(request)
  if (!stepUp.ok) return stepUp.response

  await ensureSystemRbac()
  const { id } = await params
  const body = await request.json()
  const current = await prisma.role.findUnique({
    where: { id },
    include: { permissions: { include: { permission: true } } },
  })
  if (!current) return NextResponse.json({ error: "Role not found" }, { status: 404 })

  const permissionKeys = Array.isArray(body.permissions) ? body.permissions.map(String) : []
  const permissions = await prisma.permission.findMany({ where: { key: { in: permissionKeys } }, select: { id: true } })
  const nextSlug = current.isSystem ? current.slug : slugify(String(body.slug || current.slug || body.name || current.name))

  const updated = await prisma.$transaction(async (tx) => {
    const role = await tx.role.update({
      where: { id },
      data: {
        name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : current.name,
        slug: nextSlug,
        description: typeof body.description === "string" ? body.description.trim() : current.description,
      },
    })
    await tx.rolePermission.deleteMany({ where: { roleId: id } })
    if (permissions.length) {
      await tx.rolePermission.createMany({
        data: permissions.map((permission) => ({ roleId: id, permissionId: permission.id })),
        skipDuplicates: true,
      })
    }
    return role
  })

  await createAuditLog({
    action: "admin.role.updated",
    adminId: admin.sub || null,
    actorEmail: admin.email,
    targetType: "role",
    targetId: id,
    oldValue: { name: current.name, slug: current.slug, permissions: current.permissions.map((item) => item.permission.key) },
    newValue: { name: updated.name, slug: updated.slug, permissions: permissionKeys },
  })

  return NextResponse.json({ success: true, role: updated })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !(await canManageRolesDynamic(admin.sub, admin.role))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const stepUp = await requireSensitiveAdminMfa(request)
  if (!stepUp.ok) return stepUp.response

  const { id } = await params
  const role = await prisma.role.findUnique({ where: { id }, include: { _count: { select: { admins: true } } } })
  if (!role) return NextResponse.json({ error: "Role not found" }, { status: 404 })
  if (role.isSystem) return NextResponse.json({ error: "System roles cannot be deleted" }, { status: 400 })
  if (role._count.admins > 0) return NextResponse.json({ error: "Move admins off this role before deleting it" }, { status: 400 })

  await prisma.role.delete({ where: { id } })
  await createAuditLog({
    action: "admin.role.deleted",
    adminId: admin.sub || null,
    actorEmail: admin.email,
    targetType: "role",
    targetId: id,
    oldValue: { name: role.name, slug: role.slug },
  })

  return NextResponse.json({ success: true })
}
