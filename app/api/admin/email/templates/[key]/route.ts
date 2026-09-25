import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"
import { getAdminFromCookies } from "@/lib/server-auth"
import { getEmailTemplate } from "@/lib/email/templates"
import { isAdminLikeRole } from "@/lib/admin-rbac"

function text(value: unknown) {
  return String(value || "").trim()
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized", code: "ADMIN_ONLY" }, { status: 401 })
  }

  const { key } = await params
  const existing = await getEmailTemplate(key)
  if (!existing) {
    return NextResponse.json({ success: false, error: "Template not found", code: "TEMPLATE_NOT_FOUND" }, { status: 404 })
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const subject = text(body.subject)
  const htmlBody = String(body.htmlBody || "")
  const textBody = String(body.textBody || "")
  if (!subject || !htmlBody || !textBody) {
    return NextResponse.json({ success: false, error: "Subject, HTML body, and text body are required", code: "INVALID_TEMPLATE" }, { status: 400 })
  }

  const updated = await prisma.emailTemplate.update({
    where: { key },
    data: {
      name: text(body.name) || existing.name,
      subject,
      preheader: String(body.preheader || ""),
      htmlBody,
      textBody,
      category: text(body.category) || existing.category,
      group: text(body.group) || existing.group,
      enabled: Boolean(body.enabled),
      updatedBy: String(admin.email),
    },
  })
  await createPanelLog({ category: "Admin Action", message: "email_template_updated", actorType: "admin", actorEmail: String(admin.email), metadata: { key } }).catch(() => null)
  return NextResponse.json({ success: true, template: updated })
}
