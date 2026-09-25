import { NextRequest, NextResponse } from "next/server"
import { getCurrentMfaSubject } from "@/lib/auth/mfa/current-subject"
import { logSecurityEvent } from "@/lib/auth/mfa/events"
import { clearAuthCookies, revokeAllAuthStateForUser } from "@/lib/logout"
import { clearTrustedDeviceCookie } from "@/lib/auth/mfa/trusted-devices"

export async function DELETE(request: NextRequest) {
  const subject = await getCurrentMfaSubject()
  if (!subject) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  if (body?.all !== true) return NextResponse.json({ error: "Set all=true to revoke all sessions." }, { status: 400 })
  await revokeAllAuthStateForUser({ userId: subject.userId, role: subject.role, userType: subject.userType })
  await logSecurityEvent({ userType: subject.userType, userId: subject.userId, eventType: "all_sessions_revoked" })
  const response = NextResponse.json({ success: true })
  clearAuthCookies(response)
  clearTrustedDeviceCookie(response)
  return response
}
