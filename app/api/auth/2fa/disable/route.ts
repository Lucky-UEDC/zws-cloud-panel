import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { getCurrentMfaSubject } from "@/lib/auth/mfa/current-subject"
import { disableTotpForSubject, verifyTotpForSubject } from "@/lib/auth/mfa/totp"

export async function POST(request: NextRequest) {
  try {
    const subject = await getCurrentMfaSubject()
    if (!subject) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const body = (await request.json().catch(() => ({}))) as { password?: string; code?: string }
    const password = String(body.password || "")
    const code = String(body.code || "").trim()
    if (!subject.hashedPassword || !password || !(await bcrypt.compare(password, subject.hashedPassword))) {
      return NextResponse.json({ error: "Password confirmation failed" }, { status: 401 })
    }
    if (!(await verifyTotpForSubject(subject, code))) {
      return NextResponse.json({ error: "Invalid verification code" }, { status: 401 })
    }
    await disableTotpForSubject(subject)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[auth] 2fa disable error", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
