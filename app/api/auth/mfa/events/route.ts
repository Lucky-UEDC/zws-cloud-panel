import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getCurrentMfaSubject } from "@/lib/auth/mfa/current-subject"

export async function GET() {
  const subject = await getCurrentMfaSubject()
  if (!subject) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const events = await (prisma as any).userSecurityEvent.findMany({
    where: { userType: subject.userType, userId: subject.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  }).catch(() => [])
  return NextResponse.json({ events })
}

