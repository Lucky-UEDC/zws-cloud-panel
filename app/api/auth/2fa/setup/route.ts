import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { getCurrentMfaSubject } from "@/lib/auth/mfa/current-subject"
import { beginTotpSetup, enableTotpForSubject } from "@/lib/auth/mfa/totp"

export async function POST(request: NextRequest) {
  try {
    const subject = await getCurrentMfaSubject()
    if (!subject) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const body = (await request.json().catch(() => ({}))) as { password?: string; code?: string; secret?: string }
    const password = String(body.password || "")
    if (!subject.hashedPassword || !password || !(await bcrypt.compare(password, subject.hashedPassword))) {
      return NextResponse.json({ error: "Password confirmation failed" }, { status: 401 })
    }

    const code = String(body.code || "").trim()
    const secret = String(body.secret || "").trim()
    if (!code) {
      return NextResponse.json(await beginTotpSetup(subject))
    }
    if (!secret) return NextResponse.json({ error: "Setup secret is required" }, { status: 400 })
    const backupCodes = await enableTotpForSubject(subject, secret, code)
    return NextResponse.json({ success: true, backupCodes })
  } catch (error: any) {
    console.error("[auth] totp setup error", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
