/**
 * Removes credential / secret fields from Customer records before they are
 * serialized in API responses. Admin list/detail endpoints previously spread
 * the whole Prisma row, leaking hashedPassword, 2FA secrets and OTP values.
 */
const SENSITIVE_CUSTOMER_FIELDS = [
  "hashedPassword",
  "twoFactorSecret",
  "twoFactorBackupCodes",
  "whatsappLastOtp",
  "whatsappOtpAttempts",
  "phoneOtpSentAt",
  "phoneVerificationAttempts",
  "passwordResetTokens",
] as const

export function sanitizeCustomer<T extends Record<string, any>>(customer: T): Omit<T, (typeof SENSITIVE_CUSTOMER_FIELDS)[number]> {
  if (!customer || typeof customer !== "object") return customer
  const cleaned = { ...customer }
  for (const field of SENSITIVE_CUSTOMER_FIELDS) {
    delete cleaned[field]
  }
  return cleaned
}