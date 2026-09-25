import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { getAdminFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { getSetting, passwordMeetsRules, type SecuritySettings } from "@/lib/settings"
import { revokeSessionsForUser } from "@/lib/auth/session-store"

export async function PUT(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json()) as { currentPassword?: string; newPassword?: string }
  const currentPassword = String(body.currentPassword || "")
  const newPassword = String(body.newPassword || "")

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Current and new password are required" }, { status: 400 })
  }

  const security = await getSetting<SecuritySettings>("security_settings")
  if (!passwordMeetsRules(newPassword, security)) {
    return NextResponse.json({ error: "New password does not meet policy requirements" }, { status: 400 })
  }

  const user = await prisma.adminProfile.findUnique({ where: { email: String(admin.email).toLowerCase() } })
  if (!user) {
    return NextResponse.json({ error: "Admin not found" }, { status: 404 })
  }

  const valid = await bcrypt.compare(currentPassword, user.hashedPassword)
  if (!valid) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 })
  }

  const hashed = await bcrypt.hash(newPassword, 10)
  await prisma.adminProfile.update({ where: { id: user.id }, data: { hashedPassword: hashed } })
  await revokeSessionsForUser(user.id).catch(() => null)

  return NextResponse.json({ success: true })
}
