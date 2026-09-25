import { prisma } from "@/lib/db"
import type { MfaSubject } from "@/lib/auth/mfa/types"
import { encryptSecret } from "@/lib/auth/mfa/crypto"
import { getEmailConfig } from "@/lib/email/config"

export type MfaMethodAvailability = {
  totp: boolean
  email: boolean
  whatsapp: boolean
  recovery: boolean
  trusted_device?: boolean
}

export async function ensureMfaSettings(subject: MfaSubject) {
  const existing = await (prisma as any).userMfaSetting.findUnique({
    where: { userType_userId: { userType: subject.userType, userId: subject.userId } },
  }).catch(() => null)
  if (existing) {
    if (!existing.recoveryCodesEnabled) {
      const backupCount = await (prisma as any).userBackupCode.count({
        where: { userType: subject.userType, userId: subject.userId, usedAt: null },
      }).catch(() => 0)
      if (backupCount > 0) {
        return (prisma as any).userMfaSetting.update({
          where: { userType_userId: { userType: subject.userType, userId: subject.userId } },
          data: { recoveryCodesEnabled: true },
        }).catch(() => ({ ...existing, recoveryCodesEnabled: true }))
      }
    }
    return existing
  }

  const hasLegacyTotp = Boolean(subject.legacyTotpEnabled && subject.legacyTotpSecret)
  // Concurrent logins for the same subject can race two findUnique-then-create calls;
  // upsert so the loser of the race returns the winner's row instead of throwing P2002.
  return (prisma as any).userMfaSetting.upsert({
    where: { userType_userId: { userType: subject.userType, userId: subject.userId } },
    update: {},
    create: {
      userType: subject.userType,
      userId: subject.userId,
      defaultMethod: hasLegacyTotp ? "totp" : subject.phone ? "whatsapp" : "none",
      whatsappEnabled: Boolean(subject.phone && subject.phoneVerified),
      totpEnabled: hasLegacyTotp,
      emailFallbackEnabled: false,
      recoveryCodesEnabled: false,
      trustedDeviceDays: 30,
      totpSecretEncrypted: hasLegacyTotp ? encryptSecret(String(subject.legacyTotpSecret)) : null,
      totpEnabledAt: hasLegacyTotp ? new Date() : null,
    },
  })
}

export async function getMfaSettings(userType: string, userId: string) {
  return (prisma as any).userMfaSetting.findUnique({
    where: { userType_userId: { userType, userId } },
  })
}

export function getMfaMethodAvailability(subject: MfaSubject, settings: any): MfaMethodAvailability {
  return {
    totp: Boolean(settings?.totpEnabled && settings?.totpSecretEncrypted),
    email: Boolean(subject.email && (subject.userType === "admin" || settings?.emailFallbackEnabled)),
    whatsapp: Boolean(settings?.whatsappEnabled && subject.phone && subject.phoneVerified !== false),
    recovery: Boolean(settings?.recoveryCodesEnabled || subject.legacyBackupCodes),
    trusted_device: Boolean(settings?.trustedDeviceAvailable),
  }
}

export function hasUsableMfaMethod(subject: MfaSubject, settings: any) {
  const methods = getMfaMethodAvailability(subject, settings)
  return methods.totp || methods.email || methods.whatsapp || methods.recovery
}

export async function isEmailMfaDeliveryReady() {
  const config = await getEmailConfig({ createFromLegacyIfMissing: false }).catch(() => null)
  return Boolean(
    config?.enabled &&
      String(config.smtpHost || "").trim() &&
      String(config.smtpUser || "").trim() &&
      String(config.smtpPass || "").trim() &&
      String(config.fromEmail || "").trim()
  )
}

export async function getDeliverableMfaMethods(subject: MfaSubject, settings: any): Promise<MfaMethodAvailability> {
  const methods = getMfaMethodAvailability(subject, settings)
  return {
    ...methods,
    email: methods.email ? await isEmailMfaDeliveryReady() : false,
  }
}

export async function hasDeliverableMfaMethod(subject: MfaSubject, settings: any) {
  const methods = await getDeliverableMfaMethods(subject, settings)
  return methods.totp || methods.email || methods.whatsapp || methods.recovery
}
