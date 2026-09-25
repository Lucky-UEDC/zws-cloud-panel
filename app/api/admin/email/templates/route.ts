import { NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { EMAIL_TEMPLATE_VARIABLES, listEmailTemplates } from "@/lib/email/templates"
import { isAdminLikeRole } from "@/lib/admin-rbac"

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized", code: "ADMIN_ONLY" }, { status: 401 })
  }

  const templates = await listEmailTemplates()
  return NextResponse.json({ success: true, templates, variables: EMAIL_TEMPLATE_VARIABLES })
}
