export const CLIENT_ROLES = ["client"] as const
export const STAFF_ROLES = ["super_admin", "admin", "support_agent", "blog_writer", "billing_manager", "infrastructure_manager", "seo_agent"] as const
export const USER_ROLES = ["client", ...STAFF_ROLES] as const

export type ClientRole = (typeof CLIENT_ROLES)[number]
export type StaffRole = (typeof STAFF_ROLES)[number]
export type UserRole = (typeof USER_ROLES)[number]

export function isStaffRole(role: string | null | undefined): role is StaffRole {
  return Boolean(normalizeStaffRole(role))
}

export function isUserRole(role: string | null | undefined): role is UserRole {
  return role === "client" || role === "CUSTOMER" || Boolean(normalizeStaffRole(role))
}

export function getDashboardHref(role: string | null | undefined) {
  switch (normalizeStaffRole(role)) {
    case "super_admin":
    case "admin":
      return "/admin"
    case "support_agent":
      return "/admin/customers"
    case "blog_writer":
    case "seo_agent":
      return "/admin/cms/posts"
    case "billing_manager":
      return "/admin/invoices"
    case "infrastructure_manager":
      return "/admin/compute-nodes"
    default:
      return "/client-area"
  }
}

export function canAccessAdminRoute(role: string | null | undefined) {
  return ["super_admin", "admin", "blog_writer", "billing_manager", "infrastructure_manager", "seo_agent"].includes(normalizeStaffRole(role) || "")
}

export function canAccessSupportRoute(role: string | null | undefined) {
  return ["super_admin", "admin", "support_agent"].includes(normalizeStaffRole(role) || "")
}

export function normalizeStaffRole(role: string | null | undefined): StaffRole | null {
  const value = String(role || "").trim().toLowerCase()
  if (value === "super_admin" || value === "superadmin" || value === "owner" || value === "owner_admin") return "super_admin"
  if (value === "blog_writer" || value === "blogwriter" || value === "writer" || value === "content_writer") return "blog_writer"
  if (value === "seo_agent" || value === "seoagent" || value === "seo_manager" || value === "seomanager" || value === "seo") return "seo_agent"
  if (value === "billing_manager" || value === "billing" || value === "billingmanager") return "billing_manager"
  if (value === "infrastructure_manager" || value === "infra_manager" || value === "infrastructure" || value === "infra") return "infrastructure_manager"
  if (value === "support_agent" || value === "support" || value === "supportagent") return "support_agent"
  if (value === "admin") return "admin"
  return null
}

export function isSuperAdmin(role: string | null | undefined) {
  return normalizeStaffRole(role) === "super_admin"
}

export function isAdminLikeRole(role: string | null | undefined) {
  return ["super_admin", "admin"].includes(normalizeStaffRole(role) || "")
}

export function roleLabel(role: string | null | undefined) {
  switch (normalizeStaffRole(role)) {
    case "super_admin":
      return "SUPER_ADMIN"
    case "admin":
      return "ADMIN"
    case "support_agent":
      return "SUPPORT_AGENT"
    case "blog_writer":
      return "BLOG_WRITER"
    case "billing_manager":
      return "BILLING_MANAGER"
    case "infrastructure_manager":
      return "INFRASTRUCTURE_MANAGER"
    case "seo_agent":
      return "SEO_AGENT"
    default:
      return "CLIENT"
  }
}
