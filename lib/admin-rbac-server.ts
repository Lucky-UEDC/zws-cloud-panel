import "server-only"

import {
  dynamicByLegacy,
  normalizeStaffRole,
  PERMISSION_DEFINITIONS,
  SYSTEM_ROLE_DEFINITIONS,
  type DynamicPermission,
} from "@/lib/admin-rbac"
import { prisma } from "@/lib/db"

export { PERMISSION_DEFINITIONS, SYSTEM_ROLE_DEFINITIONS } from "@/lib/admin-rbac"

export async function ensureSystemRbac() {
  await Promise.all(
    PERMISSION_DEFINITIONS.map((permission) =>
      prisma.permission.upsert({
        where: { key: permission.key },
        update: { module: permission.module, description: permission.description },
        create: permission,
      }),
    ),
  )

  for (const role of SYSTEM_ROLE_DEFINITIONS) {
    const saved = await prisma.role.upsert({
      where: { slug: role.slug },
      update: { name: role.name, description: role.description, isSystem: true },
      create: { name: role.name, slug: role.slug, description: role.description, isSystem: true },
    })
    const permissions = await prisma.permission.findMany({ where: { key: { in: role.permissions } }, select: { id: true } })
    await prisma.rolePermission.deleteMany({ where: { roleId: saved.id } })
    if (permissions.length) {
      await prisma.rolePermission.createMany({
        data: permissions.map((permission) => ({ roleId: saved.id, permissionId: permission.id })),
        skipDuplicates: true,
      })
    }
  }
}

export async function getAdminPermissions(adminId: string | null | undefined, fallbackRole?: string | null) {
  if (!adminId) return new Set<DynamicPermission>(dynamicByLegacy[normalizeStaffRole(fallbackRole) || "support_agent"] || [])
  const admin = await prisma.adminProfile.findUnique({
    where: { id: adminId },
    select: {
      role: true,
      roleRef: { select: { slug: true, permissions: { select: { permission: { select: { key: true } } } } } },
    },
  }).catch(() => null)
  const role = normalizeStaffRole(admin?.roleRef?.slug || admin?.role || fallbackRole)
  if (role === "super_admin") return new Set<DynamicPermission>(dynamicByLegacy.super_admin)
  const dbPermissions = admin?.roleRef?.permissions?.map((item) => item.permission.key as DynamicPermission).filter(Boolean) || []
  return new Set<DynamicPermission>(dbPermissions.length ? dbPermissions : dynamicByLegacy[role || "support_agent"] || [])
}

export async function requirePermission(adminId: string | null | undefined, permission: DynamicPermission, fallbackRole?: string | null) {
  const permissions = await getAdminPermissions(adminId, fallbackRole)
  return permissions.has(permission)
}

export async function hasAnyAdminPermission(adminId: string | null | undefined, permissions: DynamicPermission[], fallbackRole?: string | null) {
  const granted = await getAdminPermissions(adminId, fallbackRole)
  return permissions.some((permission) => granted.has(permission))
}

export async function canManageAdminAccounts(adminId: string | null | undefined, fallbackRole?: string | null) {
  return hasAnyAdminPermission(adminId, ["admins.manage"], fallbackRole)
}

export async function canManageRolesDynamic(adminId: string | null | undefined, fallbackRole?: string | null) {
  return hasAnyAdminPermission(adminId, ["roles.manage"], fallbackRole)
}
