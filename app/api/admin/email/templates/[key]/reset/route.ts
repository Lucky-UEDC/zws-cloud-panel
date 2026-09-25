import { NextResponse } from "next/server"
import { createPanelLog } from "@/lib/panel-log"
import { getAdminFromCookies } from "@/lib/server-auth"
import { resetEmailTemplate } from "@/lib/email/templates"
import { isAdminLikeRole } from "@/lib/admin-rbac"

export async function POST(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized", code: "ADMIN_ONLY" }, { status: 401 })
  }

  const { key } = await params
  const template = await resetEmailTemplate(key, String(admin.email))
  if (!template) {
    return NextResponse.json({ success: false, error: "Template not found", code: "TEMPLATE_NOT_FOUND" }, { status: 404 })
  }
  await createPanelLog({ category: "Admin Action", message: "email_template_reset", actorType: "admin", actorEmail: String(admin.email), metadata: { key } }).catch(() => null)
  return NextResponse.json({ success: true, template })
}
