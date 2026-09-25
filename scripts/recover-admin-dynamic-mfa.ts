import { prisma } from "@/lib/db"
import { updateRuntimeSecurityPolicy } from "@/lib/security-policy"
import { logSecurityEvent } from "@/lib/auth/mfa/events"

const ADMIN_EMAIL = (process.env.ADMIN_RECOVERY_EMAIL || "admin@freerdp.in").trim().toLowerCase()

async function main() {
  const admin = await prisma.adminProfile.findUnique({ where: { email: ADMIN_EMAIL } })
  if (!admin) throw new Error(`Admin account not found: ${ADMIN_EMAIL}`)

  const p = prisma as any
  const backupCount = await p.userBackupCode.count({
    where: { userType: "admin", userId: admin.id, usedAt: null },
  }).catch(() => 0)

  await prisma.$transaction([
    prisma.adminProfile.update({
      where: { id: admin.id },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: null as any,
        twoFactorEnabledAt: null,
        whatsappMfaEnabled: Boolean(admin.phone && admin.phoneVerified),
      } as any,
    }),
    p.userMfaSetting.upsert({
      where: { userType_userId: { userType: "admin", userId: admin.id } },
      create: {
        userType: "admin",
        userId: admin.id,
        defaultMethod: admin.phone && admin.phoneVerified ? "whatsapp" : "none",
        whatsappEnabled: Boolean(admin.phone && admin.phoneVerified),
        totpEnabled: false,
        emailFallbackEnabled: false,
        recoveryCodesEnabled: backupCount > 0,
        trustedDeviceDays: 30,
        totpSecretEncrypted: null,
        totpEnabledAt: null,
      },
      update: {
        defaultMethod: admin.phone && admin.phoneVerified ? "whatsapp" : "none",
        whatsappEnabled: Boolean(admin.phone && admin.phoneVerified),
        totpEnabled: false,
        emailFallbackEnabled: false,
        totpSecretEncrypted: null,
        totpEnabledAt: null,
        recoveryCodesEnabled: backupCount > 0,
      },
    }),
    p.mfaChallenge.deleteMany({
      where: { userType: "admin", userId: admin.id, verified: false },
    }),
    p.otpCode.deleteMany({
      where: { userType: "admin", userId: admin.id, verified: false },
    }),
  ])

  const policy = await updateRuntimeSecurityPolicy({ mfaMode: "recommend" }, "admin-mfa-recovery-script")
  await logSecurityEvent({
    userType: "admin",
    userId: admin.id,
    eventType: "admin_dynamic_mfa_recovered",
    metadata: {
      email: ADMIN_EMAIL,
      defaultMethod: admin.phone && admin.phoneVerified ? "whatsapp" : "none",
      whatsappEnabled: Boolean(admin.phone && admin.phoneVerified),
      mfaMode: policy.mfaMode,
      staleChallengesCleared: true,
    },
  })

  console.log(JSON.stringify({
    ok: true,
    email: ADMIN_EMAIL,
    adminId: admin.id,
    mfaMode: policy.mfaMode,
    defaultMethod: admin.phone && admin.phoneVerified ? "whatsapp" : "none",
    whatsappEnabled: Boolean(admin.phone && admin.phoneVerified),
    totpEnabled: false,
    emailFallbackEnabled: false,
    recoveryCodesEnabled: backupCount > 0,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
