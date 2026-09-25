import QRCode from "qrcode"
import speakeasy from "speakeasy"
import { verifySync } from "otplib"
import { prisma } from "@/lib/db"
import { getBrandName } from "@/lib/settings/site-settings"
import { decryptSecret, encryptSecret, generateRecoveryCode, hashMfaValue } from "@/lib/auth/mfa/crypto"
import { ensureMfaSettings } from "@/lib/auth/mfa/settings"
import { logSecurityEvent } from "@/lib/auth/mfa/events"
import type { MfaSubject } from "@/lib/auth/mfa/types"

const authenticator = {
  options: {
    step: 30,
    window: 1,
  },
  check(token: string, secret: string) {
    const result = verifySync({
      strategy: "totp",
      token,
      secret,
      period: this.options.step,
      epochTolerance: [this.options.step * this.options.window, this.options.step * this.options.window],
    })
    return Boolean(result.valid)
  },
}

authenticator.options = {
  step: 30,
  window: 1,
}

export type TotpVerificationResult =
  | { ok: true }
  | { ok: false; code: string; message: string; status: number }

function normalizeBase32Secret(value: string) {
  return String(value || "").replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase()
}

function normalizeTotpToken(value: string) {
  return String(value || "").trim().replace(/\s+/g, "")
}

function debugTotpVerification(input: { token: string; secret: string; isValid: boolean }) {
  console.info("[MFA] verification result", {
    method: "totp",
    result: input.isValid,
    serverTimestamp: new Date().toISOString(),
    tokenLength: input.token.length,
    tokenPresent: Boolean(input.token),
    secretExists: Boolean(input.secret),
    secretLength: input.secret.length,
  })
}

export async function beginTotpSetup(subject: MfaSubject) {
  const issuer = await getBrandName()
  const secret = speakeasy.generateSecret({
    length: 20,
    name: `${issuer}:${subject.email}`,
    issuer,
  })
  const base32 = normalizeBase32Secret(secret.base32)
  const otpauthUri = secret.otpauth_url || `otpauth://totp/${encodeURIComponent(`${issuer}:${subject.email}`)}?secret=${encodeURIComponent(base32)}&issuer=${encodeURIComponent(issuer)}`
  const qrCodeUrl = await QRCode.toDataURL(otpauthUri, { margin: 1, width: 220 })
  return { secret: base32, otpauthUri, qrCodeUrl }
}

export async function verifyTotpForSubject(subject: MfaSubject, token: string) {
  const result = await verifyTotpForSubjectDetailed(subject, token)
  return result.ok
}

export async function verifyTotpForSubjectDetailed(subject: MfaSubject, token: string): Promise<TotpVerificationResult> {
  const normalizedToken = normalizeTotpToken(token)
  if (!/^\d+$/.test(normalizedToken) || normalizedToken.length !== 6) {
    return { ok: false, code: "invalid_mfa_code", message: "Enter the 6-digit verification code.", status: 400 }
  }
  try {
    const settings = await ensureMfaSettings(subject)
    console.info("[MFA] secret exists", {
      method: "totp",
      userType: subject.userType,
      userId: subject.userId,
      exists: Boolean(settings?.totpSecretEncrypted),
      serverTimestamp: new Date().toISOString(),
    })
    if (!settings?.totpEnabled || !settings.totpSecretEncrypted) {
      return { ok: false, code: "mfa_totp_not_configured", message: "Authenticator not configured properly.", status: 400 }
    }
    let secret = ""
    try {
      secret = normalizeBase32Secret(decryptSecret(settings.totpSecretEncrypted))
    } catch (error) {
      console.warn("[MFA] totp_secret_decrypt_failed", {
        event: "totp_secret_decrypt_failed",
        userType: subject.userType,
        userId: subject.userId,
        reason: error instanceof Error ? error.message : String(error),
      })
      return { ok: false, code: "mfa_totp_reenroll_required", message: "Authenticator needs to be re-enrolled", status: 400 }
    }
    if (!secret) return { ok: false, code: "mfa_totp_not_configured", message: "Authenticator not configured properly.", status: 400 }
    console.info("[MFA] secret length", {
      method: "totp",
      userType: subject.userType,
      userId: subject.userId,
      secretLength: secret.length,
      serverTimestamp: new Date().toISOString(),
    })
    const isValid = authenticator.check(normalizedToken.trim(), secret.trim())
    debugTotpVerification({ token: normalizedToken, secret, isValid })
    return isValid ? { ok: true } : { ok: false, code: "mfa_code_expired", message: "Code expired. Try next code.", status: 401 }
  } catch (error) {
    console.warn("[MFA] totp_verify_failed", {
      event: "totp_verify_failed",
      userType: subject.userType,
      userId: subject.userId,
      reason: error instanceof Error ? error.message : String(error),
    })
    return { ok: false, code: "mfa_totp_not_configured", message: "Authenticator not configured properly.", status: 400 }
  }
}

export async function enableTotpForSubject(subject: MfaSubject, secret: string, code: string) {
  const normalizedSecret = normalizeBase32Secret(secret)
  const normalizedCode = normalizeTotpToken(code)
  const ok = authenticator.check(normalizedCode.trim(), normalizedSecret.trim())
  if (!ok) throw new Error("Invalid verification code")
  const backupCodes = Array.from({ length: 10 }, () => generateRecoveryCode())
  await (prisma as any).$transaction([
    (prisma as any).userMfaSetting.upsert({
      where: { userType_userId: { userType: subject.userType, userId: subject.userId } },
      create: {
        userType: subject.userType,
        userId: subject.userId,
        defaultMethod: "totp",
        whatsappEnabled: subject.userType === "customer",
        totpEnabled: true,
        emailFallbackEnabled: true,
        recoveryCodesEnabled: true,
        trustedDeviceDays: 30,
        totpSecretEncrypted: encryptSecret(normalizedSecret),
        totpEnabledAt: new Date(),
      },
      update: {
        defaultMethod: "totp",
        totpEnabled: true,
        recoveryCodesEnabled: true,
        totpSecretEncrypted: encryptSecret(normalizedSecret),
        totpEnabledAt: new Date(),
      },
    }),
    (prisma as any).userBackupCode.deleteMany({ where: { userType: subject.userType, userId: subject.userId } }),
    ...(backupCodes.map((backupCode) => (prisma as any).userBackupCode.create({
      data: {
        userType: subject.userType,
        userId: subject.userId,
        codeHash: hashMfaValue("backup", subject.userType, subject.userId, backupCode),
        codeEncrypted: encryptSecret(backupCode),
      },
    }))),
  ])
  await logSecurityEvent({ userType: subject.userType, userId: subject.userId, eventType: "totp_enabled", metadata: { email: subject.email } })
  return backupCodes
}

export async function disableTotpForSubject(subject: MfaSubject) {
  await (prisma as any).userMfaSetting.upsert({
    where: { userType_userId: { userType: subject.userType, userId: subject.userId } },
    create: {
      userType: subject.userType,
      userId: subject.userId,
      defaultMethod: subject.phone ? "whatsapp" : "email",
      whatsappEnabled: subject.userType === "customer",
      totpEnabled: false,
      emailFallbackEnabled: true,
      recoveryCodesEnabled: false,
    },
    update: {
      defaultMethod: subject.phone ? "whatsapp" : "email",
      totpEnabled: false,
      recoveryCodesEnabled: false,
      totpSecretEncrypted: null,
      totpEnabledAt: null,
    },
  })
  await (prisma as any).userBackupCode.deleteMany({ where: { userType: subject.userType, userId: subject.userId } }).catch(() => null)
  await logSecurityEvent({ userType: subject.userType, userId: subject.userId, eventType: "totp_disabled", metadata: { email: subject.email } })
}

export async function consumeBackupCode(subject: MfaSubject, code: string) {
  const codeHash = hashMfaValue("backup", subject.userType, subject.userId, String(code || "").trim().toUpperCase())
  const backup = await (prisma as any).userBackupCode.findFirst({
    where: { userType: subject.userType, userId: subject.userId, codeHash, usedAt: null },
  })
  if (!backup) return false
  await (prisma as any).userBackupCode.update({ where: { id: backup.id }, data: { usedAt: new Date() } })
  return true
}

export async function viewRecoveryCodesForSubject(subject: MfaSubject) {
  const rows = await (prisma as any).userBackupCode.findMany({
    where: { userType: subject.userType, userId: subject.userId, usedAt: null },
    orderBy: { createdAt: "asc" },
  }).catch(() => [])
  if (!rows.length) return { codes: [] as string[], legacyCodesNeedRegeneration: false }
  const legacyCodesNeedRegeneration = rows.some((row: any) => !row.codeEncrypted)
  if (legacyCodesNeedRegeneration) return { codes: [] as string[], legacyCodesNeedRegeneration: true }
  const codes = rows.map((row: any) => decryptSecret(row.codeEncrypted))
  return { codes, legacyCodesNeedRegeneration: false }
}

export async function regenerateRecoveryCodesForSubject(subject: MfaSubject) {
  const backupCodes = Array.from({ length: 10 }, () => generateRecoveryCode())
  await (prisma as any).$transaction([
    (prisma as any).userMfaSetting.upsert({
      where: { userType_userId: { userType: subject.userType, userId: subject.userId } },
      create: {
        userType: subject.userType,
        userId: subject.userId,
        defaultMethod: subject.phone ? "whatsapp" : "email",
        whatsappEnabled: subject.userType === "customer",
        totpEnabled: false,
        emailFallbackEnabled: true,
        recoveryCodesEnabled: true,
        trustedDeviceDays: 30,
      },
      update: { recoveryCodesEnabled: true },
    }),
    (prisma as any).userBackupCode.deleteMany({ where: { userType: subject.userType, userId: subject.userId } }),
    ...(backupCodes.map((backupCode) => (prisma as any).userBackupCode.create({
      data: {
        userType: subject.userType,
        userId: subject.userId,
        codeHash: hashMfaValue("backup", subject.userType, subject.userId, backupCode),
        codeEncrypted: encryptSecret(backupCode),
      },
    }))),
  ])
  await logSecurityEvent({ userType: subject.userType, userId: subject.userId, eventType: "recovery_codes_regenerated", metadata: { email: subject.email } })
  return backupCodes
}
