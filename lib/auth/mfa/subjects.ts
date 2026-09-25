import { prisma } from "@/lib/db"
import type { MfaSubject } from "@/lib/auth/mfa/types"
import { normalizeStaffRole } from "@/lib/roles"

export async function resolveMfaSubject(userType: string, userId: string): Promise<MfaSubject | null> {
  if (userType === "admin") {
    const admin = await prisma.adminProfile.findUnique({ where: { id: userId } })
    if (!admin?.isActive) return null
    return {
      userType: "admin",
      userId: admin.id,
      role: normalizeStaffRole(admin.role) || "admin",
      email: admin.email,
      name: admin.displayName,
      phone: (admin as any).phoneVerified ? (admin as any).phone : null,
      phoneVerified: (admin as any).phoneVerified,
      hashedPassword: admin.hashedPassword,
      legacyTotpEnabled: admin.twoFactorEnabled,
      legacyTotpSecret: admin.twoFactorSecret,
      legacyBackupCodes: admin.twoFactorBackupCodes,
    }
  }
  const customer = await prisma.customer.findUnique({ where: { id: userId } })
  if (!customer?.isActive || customer.status === "BANNED" || customer.status === "CLOSED") return null
  return {
    userType: "customer",
    userId: customer.id,
    role: "client",
    email: customer.email,
    name: customer.name,
    phone: customer.phone,
    phoneVerified: customer.phoneVerified,
    hashedPassword: customer.hashedPassword,
    legacyTotpEnabled: customer.twoFactorEnabled,
    legacyTotpSecret: customer.twoFactorSecret,
    legacyBackupCodes: customer.twoFactorBackupCodes,
  }
}
