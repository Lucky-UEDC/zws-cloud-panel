export type SmsProviderName = "twilio" | "msg91" | "textlocal"

export type SmsOtpInput = {
  to: string
  code: string
  siteName: string
  expiresInMinutes?: number
}

export type SmsProvider = {
  name: SmsProviderName
  enabled: boolean
  sendOtp(input: SmsOtpInput): Promise<{ ok: boolean; providerMessageId?: string | null; error?: string }>
}

function disabledProvider(name: SmsProviderName): SmsProvider {
  return {
    name,
    enabled: false,
    async sendOtp() {
      return { ok: false, error: `${name} SMS MFA provider is not configured.` }
    },
  }
}

export const smsMfaProviders: Record<SmsProviderName, SmsProvider> = {
  twilio: disabledProvider("twilio"),
  msg91: disabledProvider("msg91"),
  textlocal: disabledProvider("textlocal"),
}

export function getSmsMfaProvider(name: string | null | undefined) {
  const key = String(name || "").toLowerCase() as SmsProviderName
  return smsMfaProviders[key] || null
}
