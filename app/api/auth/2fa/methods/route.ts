import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db"
import { getCurrentMfaSubject } from "@/lib/auth/mfa/current-subject"
import { ensureMfaSettings, getMfaMethodAvailability } from "@/lib/auth/mfa/settings"
import { logSecurityEvent } from "@/lib/auth/mfa/events"

const methods = new Set(["totp", "email", "whatsapp", "recovery"])

async function confirmPassword(subject: Awaited<ReturnType<typeof getCurrentMfaSubject>>, password: string) {
  return Boolean(subject?.hashedPassword && password && await bcrypt.compare(password, subject.hashedPassword))
}

export async function PATCH(request: NextRequest) {
  const subject = await getCurrentMfaSubject()
  if (!subject) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const method = String(body.method || "").toLowerCase()
  const enabled = Boolean(body.enabled)
  const makeDefault = body.default === true || body.makeDefault === true
  if (!methods.has(method)) return NextResponse.json({ error: "Unsupported MFA method" }, { status: 400 })
  if (!(await confirmPassword(subject, String(body.password || "")))) {
    return NextResponse.json({ error: "Password confirmation failed" }, { status: 401 })
  }

  const settings = await ensureMfaSettings(subject)
  const data: Record<string, unknown> = {}
  if (method === "email") data.emailFallbackEnabled = enabled
  if (method === "whatsapp") {
    if (enabled && (!subject.phone || subject.phoneVerified === false)) {
      return NextResponse.json({ error: "Verify a WhatsApp phone number before enabling WhatsApp MFA." }, { status: 400 })
    }
    data.whatsappEnabled = enabled
  }
  if (method === "recovery") data.recoveryCodesEnabled = enabled
  if (method === "totp" && !enabled) {
    data.totpEnabled = false
    data.totpSecretEncrypted = null
    data.totpEnabledAt = null
  }

  const availability = getMfaMethodAvailability(subject, { ...settings, ...data })
  if (enabled && makeDefault) data.defaultMethod = method
  if (!enabled && settings.defaultMethod === method) {
    data.defaultMethod = availability.totp ? "totp" : availability.whatsapp ? "whatsapp" : availability.email ? "email" : "none"
  }

  const updated = await (prisma as any).userMfaSetting.update({
    where: { userType_userId: { userType: subject.userType, userId: subject.userId } },
    data,
  })
  await logSecurityEvent({
    userType: subject.userType,
    userId: subject.userId,
    eventType: "mfa_method_updated",
    metadata: { method, enabled, makeDefault },
  })
  return NextResponse.json({ success: true, settings: updated })
}
