import "dotenv/config"
import { prisma } from "@/lib/db"

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@example.com"
const ADMIN_PHONE = "+917750008100"

async function main() {
  const admin = await prisma.adminProfile.findUnique({ where: { email: ADMIN_EMAIL } })
  if (!admin) throw new Error(`Admin account not found: ${ADMIN_EMAIL}`)

  await prisma.adminProfile.update({
    where: { id: admin.id },
    data: {
      phone: ADMIN_PHONE,
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
      whatsappMfaEnabled: true,
      isActive: true,
    } as any,
  })

  await (prisma as any).userMfaSetting.upsert({
    where: { userType_userId: { userType: "admin", userId: admin.id } },
    update: {
      defaultMethod: "whatsapp",
      whatsappEnabled: true,
      emailFallbackEnabled: true,
      totpEnabled: false,
    },
    create: {
      userType: "admin",
      userId: admin.id,
      defaultMethod: "whatsapp",
      whatsappEnabled: true,
      emailFallbackEnabled: true,
      totpEnabled: false,
      recoveryCodesEnabled: false,
      trustedDeviceDays: 30,
    },
  })

  await prisma.authChallenge.deleteMany({
    where: {
      OR: [
        { userType: "admin", userId: admin.id },
        { expiresAt: { lt: new Date() } },
        { consumedAt: { not: null } },
      ],
    },
  })

  await prisma.session.updateMany({
    where: { userId: admin.id, role: { not: "client" }, revokedAt: null },
    data: { revokedAt: new Date() },
  })

  await (prisma as any).userLoginSession.updateMany({
    where: { userType: "admin", userId: admin.id, revokedAt: null },
    data: { revokedAt: new Date() },
  }).catch(() => null)

  console.log(`Restored WhatsApp MFA for ${ADMIN_EMAIL} using ${ADMIN_PHONE}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
