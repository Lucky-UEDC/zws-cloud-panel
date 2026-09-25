import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { defaultTemplateVariables, getEmailTemplate, renderTemplateSource } from "@/lib/email/templates"
import { isAdminLikeRole } from "@/lib/admin-rbac"

export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized", code: "ADMIN_ONLY" }, { status: 401 })
  }

  const { key } = await params
  const template = await getEmailTemplate(key)
  if (!template) {
    return NextResponse.json({ success: false, error: "Template not found", code: "TEMPLATE_NOT_FOUND" }, { status: 404 })
  }
  const body = await request.json().catch(() => ({})) as { variables?: Record<string, string> }
  const variables = await defaultTemplateVariables(body.variables || {})
  return NextResponse.json({ success: true, preview: renderTemplateSource(template, variables), variables })
}
