import { prisma } from "@/lib/db"
import { getAdminFromCookies, getClientFromCookies } from "@/lib/server-auth"
import type { MfaSubject } from "@/lib/auth/mfa/types"
import { normalizeStaffRole } from "@/lib/roles"

export async function getCurrentMfaSubject(): Promise<MfaSubject | null> {
  const [admin, client] = await Promise.all([getAdminFromCookies(), getClientFromCookies()])
  if (admin?.email) {
    const user = await prisma.adminProfile.findUnique({ where: { email: String(admin.email).toLowerCase() } })
    if (!user) return null
    return {
      userType: "admin",
      userId: user.id,
      role: normalizeStaffRole(user.role) || "admin",
      email: user.email,
      name: user.displayName,
      phone: (user as any).phoneVerified ? (user as any).phone : null,
      phoneVerified: (user as any).phoneVerified,
      hashedPassword: user.hashedPassword,
      legacyTotpEnabled: user.twoFactorEnabled,
      legacyTotpSecret: user.twoFactorSecret,
      legacyBackupCodes: user.twoFactorBackupCodes,
    }
  }
  if (client?.sub) {
    const user = await prisma.customer.findUnique({ where: { id: String(client.sub) } })
    if (!user) return null
    return {
      userType: "customer",
      userId: user.id,
      role: "client",
      email: user.email,
      name: user.name,
      phone: user.phone,
      phoneVerified: user.phoneVerified,
      hashedPassword: user.hashedPassword,
      legacyTotpEnabled: user.twoFactorEnabled,
      legacyTotpSecret: user.twoFactorSecret,
      legacyBackupCodes: user.twoFactorBackupCodes,
    }
  }
  return null
}
