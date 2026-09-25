import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { defaultTemplateVariables } from "@/lib/email/templates"
import { sendTemplateEmail } from "@/lib/email/send-mail"
import { isAdminLikeRole } from "@/lib/admin-rbac"

export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized", code: "ADMIN_ONLY" }, { status: 401 })
  }

  const { key } = await params
  const body = await request.json().catch(() => ({})) as { to?: string; recipient?: string; variables?: Record<string, string> }
  const target = String(body.to || body.recipient || "").trim()
  if (!target || !/^\S+@\S+\.\S+$/.test(target)) {
    return NextResponse.json({ success: false, error: "Valid recipient email is required", code: "SMTP_RECIPIENT_INVALID" }, { status: 400 })
  }

  try {
    const variables = await defaultTemplateVariables(body.variables || {})
    const result = await sendTemplateEmail({ templateKey: key, to: target, variables, throwOnError: true, metadata: { test: true, requestedBy: admin.email } })
    return NextResponse.json({ success: true, message: `Template test sent to ${target}.`, result })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Template test failed", code: error?.code || "EMAIL_TEST_FAILED" }, { status: error?.statusCode || 400 })
  }
}
