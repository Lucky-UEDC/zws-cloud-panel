import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getCurrentMfaSubject } from "@/lib/auth/mfa/current-subject"
import { logSecurityEvent } from "@/lib/auth/mfa/events"

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const subject = await getCurrentMfaSubject()
  if (!subject) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const session = await (prisma as any).userLoginSession.findFirst({
    where: { id, userType: subject.userType, userId: subject.userId },
  })
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 })
  await Promise.all([
    prisma.session.updateMany({ where: { sessionIdHash: session.sessionIdHash, revokedAt: null }, data: { revokedAt: new Date() } }),
    (prisma as any).userLoginSession.update({ where: { id }, data: { revokedAt: new Date() } }),
  ])
  await logSecurityEvent({ userType: subject.userType, userId: subject.userId, eventType: "session_revoked", metadata: { sessionId: id } })
  return NextResponse.json({ success: true })
}

