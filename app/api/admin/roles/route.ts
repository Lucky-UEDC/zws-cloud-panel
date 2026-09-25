import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { createAuditLog } from "@/lib/audit-log"
import { canManageRolesDynamic, ensureSystemRbac, PERMISSION_DEFINITIONS } from "@/lib/admin-rbac-server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { requireSensitiveAdminMfa } from "@/lib/admin-sensitive-action"

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !(await canManageRolesDynamic(admin.sub, admin.role))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  await ensureSystemRbac()
  const [roles, permissions] = await Promise.all([
    prisma.role.findMany({
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { admins: true } },
      },
    }),
    prisma.permission.findMany({ orderBy: [{ module: "asc" }, { key: "asc" }] }),
  ])

  return NextResponse.json({
    roles: roles.map((role) => ({
      id: role.id,
      name: role.name,
      slug: role.slug,
      description: role.description,
      isSystem: role.isSystem,
      adminCount: role._count.admins,
      permissions: role.permissions.map((item) => item.permission.key),
    })),
    permissions,
    definitions: PERMISSION_DEFINITIONS,
  })
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !(await canManageRolesDynamic(admin.sub, admin.role))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const stepUp = await requireSensitiveAdminMfa(request)
  if (!stepUp.ok) return stepUp.response

  await ensureSystemRbac()
  const body = await request.json()
  const name = String(body.name || "").trim()
  const cloneFromId = typeof body.cloneFromId === "string" ? body.cloneFromId : null
  const permissionKeys = Array.isArray(body.permissions) ? body.permissions.map(String) : null
  if (!name) {
    return NextResponse.json({ error: "Role name is required" }, { status: 400 })
  }

  const baseSlug = slugify(body.slug ? String(body.slug) : name)
  let slug = baseSlug
  let suffix = 2
  while (await prisma.role.findUnique({ where: { slug } })) {
    slug = `${baseSlug}_${suffix++}`
  }

  const clonedPermissions = cloneFromId
    ? await prisma.rolePermission.findMany({ where: { roleId: cloneFromId }, select: { permission: { select: { key: true } } } })
    : []
  const keys = permissionKeys || clonedPermissions.map((item) => item.permission.key)
  const permissions = keys.length ? await prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } }) : []

  const role = await prisma.role.create({
    data: {
      name,
      slug,
      description: typeof body.description === "string" ? body.description.trim() : null,
      isSystem: false,
      permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) },
    },
  })

  await createAuditLog({
    action: "admin.role.created",
    adminId: admin.sub || null,
    actorEmail: admin.email,
    targetType: "role",
    targetId: role.id,
    newValue: { name: role.name, slug: role.slug, permissions: keys },
  })

  return NextResponse.json({ success: true, role }, { status: 201 })
}
