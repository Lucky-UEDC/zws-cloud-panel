import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { getCurrentMfaSubject } from "@/lib/auth/mfa/current-subject"
import { regenerateRecoveryCodesForSubject } from "@/lib/auth/mfa/totp"
import { logSecurityEvent } from "@/lib/auth/mfa/events"

export async function POST(request: NextRequest) {
  try {
    const subject = await getCurrentMfaSubject()
    if (!subject) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const password = String(body.password || "")
    const action = String(body.action || "view")
    if (!subject.hashedPassword || !password || !(await bcrypt.compare(password, subject.hashedPassword))) {
      return NextResponse.json({ error: "Password confirmation failed" }, { status: 401 })
    }
    if (action === "regenerate") {
      const codes = await regenerateRecoveryCodesForSubject(subject)
      await logSecurityEvent({ userType: subject.userType, userId: subject.userId, eventType: "recovery_codes_regenerated", metadata: { displayedOnce: true } })
      return NextResponse.json({ success: true, codes, regenerated: true, legacyCodesNeedRegeneration: false })
    }
    return NextResponse.json({ error: "Existing recovery codes cannot be viewed. Regenerate a new set instead." }, { status: 400 })
  } catch (error: any) {
    console.error("[auth] recovery codes error", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
