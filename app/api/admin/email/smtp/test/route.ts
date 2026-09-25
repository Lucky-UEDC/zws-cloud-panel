import { NextRequest, NextResponse } from "next/server"
import { createPanelLog } from "@/lib/panel-log"
import { getAdminFromCookies } from "@/lib/server-auth"
import { classifySmtpError, sendEmail, verifySmtpConnection } from "@/lib/email/send"
import { getEmailConfig, upsertEmailConfig } from "@/lib/email/config"
import { getBrandName } from "@/lib/settings/site-settings"
import { isAdminLikeRole } from "@/lib/admin-rbac"

function jsonError(code: string, error: string, status = 400) {
  return NextResponse.json({ ok: false, success: false, code, error }, { status })
}

function maskEmail(value: string) {
  const [name, domain] = String(value || "").split("@")
  if (!name || !domain) return "[invalid]"
  return `${name.slice(0, 2)}***@${domain}`
}

function testEmailHtml(input: { recipient: string; brandName: string }) {
  return `
    <div style="margin:0;padding:28px;background:#eef5f8;color:#0f172a;font-family:Inter,Segoe UI,Arial,sans-serif">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #dbe7ef;border-radius:18px;overflow:hidden">
        <div style="padding:24px 28px;background:#071014;color:#ffffff;font-size:18px;font-weight:800">${input.brandName}</div>
        <div style="padding:32px 28px">
          <h1 style="font-size:28px;line-height:1.2;margin:0 0 16px;color:#0f172a">SMTP configuration is working</h1>
          <p style="font-size:16px;line-height:1.65;color:#334155;margin:0 0 20px">This test confirms that ${input.brandName} can send platform email through the configured SMTP provider.</p>
          <div style="border:1px solid #dbe7ef;border-radius:14px;background:#f8fafc;padding:16px;color:#334155">Sent to ${input.recipient}<br />Time ${new Date().toISOString()}</div>
        </div>
      </div>
    </div>
  `
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return jsonError("ADMIN_UNAUTHORIZED", "Your admin session expired. Please sign in again.", 401)
  }

  const { to, recipient, config: configPatch } = (await request.json().catch(() => ({}))) as { to?: string; recipient?: string; config?: Record<string, unknown> }
  const target = String(to || recipient || "").trim()
  if (!target || !/^\S+@\S+\.\S+$/.test(target)) {
    return jsonError("SMTP_RECIPIENT_INVALID", "Valid recipient email is required", 400)
  }

  try {
    if (configPatch && Object.keys(configPatch).length) {
      await upsertEmailConfig(configPatch)
    }
    const smtp = await getEmailConfig()
    const brandName = await getBrandName()
    await verifySmtpConnection()
    const result = await sendEmail({
      to: target,
      subject: `${brandName} SMTP Test Email`,
      text: `${brandName} SMTP test email sent successfully.`,
      html: testEmailHtml({ recipient: target, brandName }),
      logMessage: "smtp_test_email_sent",
      throwOnError: true,
      metadata: { test: true, requestedBy: admin.email },
    })
    await createPanelLog({
      category: "Email",
      message: "smtp_test_email_sent",
      actorType: "admin",
      actorEmail: String(admin.email),
      metadata: { host: smtp?.smtpHost || null, port: smtp?.smtpPort || null, recipient: maskEmail(target), messageId: result.messageId },
    }).catch(() => null)
    return NextResponse.json({ ok: true, success: result.success, message: `SMTP test email sent to ${target}.`, messageId: result.messageId })
  } catch (error: any) {
    const safeError = classifySmtpError(error)
    const smtp = await getEmailConfig().catch(() => null)
    await createPanelLog({
      category: "Email",
      level: "warn",
      message: safeError.code === "SMTP_AUTH_FAILED" ? "smtp_auth_failed" : "smtp_test_email_failed",
      actorType: "admin",
      actorEmail: String(admin.email),
      metadata: { code: safeError.code, error: safeError.message, recipient: maskEmail(target), host: smtp?.smtpHost || null, port: smtp?.smtpPort || null },
    }).catch(() => null)
    return jsonError(safeError.code, safeError.message, safeError.statusCode)
  }
}
