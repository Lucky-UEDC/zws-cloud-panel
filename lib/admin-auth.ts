import { NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { type AdminPermission, hasAdminPermission, isSuperAdmin } from "@/lib/admin-rbac"

export function adminAuthError(message = "You do not have access to this section.", status = 403) {
  return NextResponse.json({ ok: false, success: false, code: "PERMISSION_DENIED", error: message }, { status })
}

export async function requireAdmin() {
  const admin = await getAdminFromCookies()
  if (!admin?.email) {
    return {
      admin: null,
      response: NextResponse.json(
        { ok: false, success: false, code: "ADMIN_UNAUTHORIZED", error: "Your admin session expired. Please sign in again." },
        { status: 401 },
      ),
    }
  }
  return { admin, response: null }
}

export async function requireAdminPermission(permission: AdminPermission) {
  const { admin, response } = await requireAdmin()
  if (response) return { admin, response }
  if (!hasAdminPermission(admin?.role, permission)) return { admin, response: adminAuthError() }
  return { admin, response: null }
}

export async function requireAdminOperation() {
  return requireAdminPermission("admin:operations")
}

export async function requireCmsAdmin() {
  return requireAdminPermission("cms:manage")
}

export async function requireSuperAdmin() {
  const { admin, response } = await requireAdmin()
  if (response) return { admin, response }
  if (!isSuperAdmin(admin?.role)) return { admin, response: adminAuthError("Only Super Admin accounts can perform this action.") }
  return { admin, response: null }
}
