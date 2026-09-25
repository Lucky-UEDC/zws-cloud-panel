import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getCurrentMfaSubject } from "@/lib/auth/mfa/current-subject"
import { logSecurityEvent } from "@/lib/auth/mfa/events"

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const subject = await getCurrentMfaSubject()
  if (!subject) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const updated = await (prisma as any).userTrustedDevice.updateMany({
    where: { id, userType: subject.userType, userId: subject.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  await logSecurityEvent({ userType: subject.userType, userId: subject.userId, eventType: "trusted_device_removed", metadata: { trustedDeviceId: id } })
  return NextResponse.json({ success: updated.count > 0 })
}

