import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db"
import { getSetting, passwordMeetsRules, type SecuritySettings } from "@/lib/settings"

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { token?: string; password?: string }
  const token = String(body.token || "")
  const password = String(body.password || "")

  if (!token || !password) {
    return NextResponse.json({ error: "Token and password are required" }, { status: 400 })
  }

  const security = await getSetting<SecuritySettings>("security_settings")
  if (!passwordMeetsRules(password, security)) {
    return NextResponse.json({ error: "Password does not meet security policy" }, { status: 400 })
  }

  const reset = await prisma.passwordResetToken.findUnique({
    where: { token },
  })

  if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
    return NextResponse.json({ error: "Reset token is invalid or expired" }, { status: 400 })
  }

  const hashedPassword = await bcrypt.hash(password, 10)

  await prisma.$transaction([
    prisma.customer.update({
      where: { id: reset.customerId },
      data: { hashedPassword },
    }),
    prisma.passwordResetToken.update({
      where: { id: reset.id },
      data: { usedAt: new Date() },
    }),
  ])

  return NextResponse.json({ success: true })
}
