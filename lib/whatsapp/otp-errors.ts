export type WhatsAppOtpStage =
  | "customer_lookup"
  | "phone_normalization"
  | "template_render"
  | "redis_queue"
  | "worker_dispatch"
  | "runtime_ready"
  | "number_registration"
  | "provider_send"
  | "provider_ack"
  | "delivery_timeout"
  | "rate_limit"
  | "verification"

export type WhatsAppOtpErrorPayload = {
  success: false
  code: string
  stage: WhatsAppOtpStage
  message: string
  retryable: boolean
  retryAfterSeconds?: number
}

const SAFE_MESSAGES: Record<string, string> = {
  customer_not_found: "Verification session was not found. Please sign in again.",
  phone_missing: "Customer phone number is missing.",
  invalid_phone: "Enter a valid WhatsApp phone number with country code.",
  redis_queue_unavailable: "WhatsApp OTP queue is unavailable. Please try again shortly.",
  template_missing: "WhatsApp OTP template is missing. Please contact support.",
  runtime_not_ready: "WhatsApp worker is not connected. Please try again shortly.",
  number_not_registered: "WhatsApp is not available on this number.",
  provider_unavailable: "WhatsApp is not available on this number.",
  provider_ack_timeout: "WhatsApp did not acknowledge the OTP message in time. Please retry.",
  provider_send_failed: "WhatsApp could not send the OTP message. Please retry.",
  rate_limited: "Too many OTP requests. Please try again later.",
  otp_invalid: "Invalid OTP.",
  otp_expired: "OTP expired. Please request a new code.",
  otp_unavailable: "Unable to send verification code.",
}

export class WhatsAppOtpError extends Error {
  code: string
  stage: WhatsAppOtpStage
  status: number
  retryable: boolean
  retryAfterSeconds?: number

  constructor(input: {
    code: string
    stage: WhatsAppOtpStage
    message?: string
    status?: number
    retryable?: boolean
    retryAfterSeconds?: number
    cause?: unknown
  }) {
    super(input.message || SAFE_MESSAGES[input.code] || "Unable to send verification code.")
    this.name = "WhatsAppOtpError"
    this.code = input.code
    this.stage = input.stage
    this.status = input.status || 503
    this.retryable = input.retryable ?? this.status >= 500
    this.retryAfterSeconds = input.retryAfterSeconds
    if (input.cause !== undefined) this.cause = input.cause
  }
}

export function createOtpCorrelationId(prefix = "otp") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function statusFromError(error: any) {
  const status = Number(error?.status || error?.statusCode || 0)
  return status >= 400 && status < 600 ? status : 503
}

export function normalizeOtpError(error: unknown, fallbackStage: WhatsAppOtpStage): WhatsAppOtpError {
  if (error instanceof WhatsAppOtpError) return error
  const anyError = error as any
  const raw = error instanceof Error ? error.message : String(error || "")
  const lower = raw.toLowerCase()
  const status = statusFromError(anyError)

  if (/redis queue is not configured|redis|bullmq|queue/i.test(raw)) {
    return new WhatsAppOtpError({ code: "redis_queue_unavailable", stage: "redis_queue", status: 503, retryable: true, cause: error })
  }
  if (/template.*missing|template.*not found|required whatsapp otp template/i.test(raw)) {
    return new WhatsAppOtpError({ code: "template_missing", stage: "template_render", status: 503, retryable: false, cause: error })
  }
  if (/phone number|country code|leading zero|invalid jid|invalid wid|malformed|valid whatsapp phone/i.test(raw)) {
    return new WhatsAppOtpError({ code: "invalid_phone", stage: "phone_normalization", status: 400, retryable: false, cause: error })
  }
  if (/not registered on whatsapp/i.test(raw)) {
    return new WhatsAppOtpError({ code: "number_not_registered", stage: "number_registration", status: 400, retryable: false, cause: error })
  }
  if (/ack timeout|did not acknowledge|delivery ack timeout/i.test(raw)) {
    return new WhatsAppOtpError({ code: "provider_ack_timeout", stage: "delivery_timeout", status: 504, retryable: true, cause: error })
  }
  if (/session|browser|chromium|puppeteer|disconnected|not connected|not ready|auth|unpaired|logout/i.test(raw)) {
    const retryable = !/auth_failure|unpaired|logout|invalidated/i.test(raw)
    return new WhatsAppOtpError({ code: "runtime_not_ready", stage: "runtime_ready", status: 503, retryable, cause: error })
  }
  if (status === 429 || /too many|rate|wait/i.test(lower)) {
    return new WhatsAppOtpError({
      code: "rate_limited",
      stage: "rate_limit",
      message: raw || SAFE_MESSAGES.rate_limited,
      status: 429,
      retryable: true,
      retryAfterSeconds: Number(anyError?.retryAfterSeconds || 0) || undefined,
      cause: error,
    })
  }
  if (/missing/i.test(lower) && /customer|phone/.test(lower)) {
    return new WhatsAppOtpError({ code: "phone_missing", stage: "customer_lookup", message: raw, status: 400, retryable: false, cause: error })
  }

  return new WhatsAppOtpError({
    code: status >= 500 ? "provider_send_failed" : "otp_unavailable",
    stage: fallbackStage,
    message: status >= 500 ? SAFE_MESSAGES.provider_send_failed : raw || SAFE_MESSAGES.otp_unavailable,
    status,
    retryable: status >= 500,
    cause: error,
  })
}

export function otpErrorResponse(error: unknown, fallbackStage: WhatsAppOtpStage): { status: number; body: WhatsAppOtpErrorPayload } {
  const normalized = normalizeOtpError(error, fallbackStage)
  return {
    status: normalized.status >= 400 && normalized.status < 600 ? normalized.status : 503,
    body: {
      success: false,
      code: normalized.code,
      stage: normalized.stage,
      message: normalized.message,
      retryable: normalized.retryable,
      ...(normalized.retryAfterSeconds ? { retryAfterSeconds: normalized.retryAfterSeconds } : {}),
    },
  }
}
