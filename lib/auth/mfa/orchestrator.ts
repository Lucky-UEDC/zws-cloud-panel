import type { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getRequestDeviceContext, deviceFingerprint } from "@/lib/auth/mfa/device"
import { assessLoginRisk } from "@/lib/auth/mfa/risk"
import { ensureMfaSettings, getMfaMethodAvailability } from "@/lib/auth/mfa/settings"
import { logSecurityEvent } from "@/lib/auth/mfa/events"
import { sendTemplateEmail } from "@/lib/email/send-mail"
import { buildNotificationVariables } from "@/lib/notifications/template-engine"
import type { MfaMethod, MfaRequestContext, MfaSubject } from "@/lib/auth/mfa/types"
import { createMfaChallenge } from "@/lib/auth/mfa/challenges"
import { assertOtpSendLimit, issueOtpCode, updateOtpProviderResult, verifyOtpCode } from "@/lib/auth/mfa/otp-codes"
import { canSendWhatsAppSessionOtp } from "@/lib/whatsapp/status"
import { sendWhatsAppMessage as enqueueWhatsAppMessage } from "@/lib/whatsapp/queue"
import { WHATSAPP_TEMPLATE_KEYS } from "@/lib/whatsapp/template-registry"
import { findEmergencyTrustedDevice } from "@/lib/auth/mfa/trusted-devices"
import { appendRuntimeLog } from "@/lib/runtime-file-log"

const RESEND_COOLDOWN_MS = 60_000
const MAX_ATTEMPTS = 5
const EMERGENCY_BYPASS_MESSAGE = "OTP delivery is unavailable. Continue once using this trusted device."

function firstName(name?: string | null) {
  return String(name || "there").trim().split(/\s+/)[0] || "there"
}

function otpSendHistory(metadata: unknown) {
  const value = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {}
  return Array.isArray(value.otpSendHistory) ? value.otpSendHistory.map(String).filter(Boolean) : []
}

export async function buildMfaContext(request: NextRequest, subject: MfaSubject): Promise<MfaRequestContext> {
  const device = await getRequestDeviceContext(request)
  const fingerprint = deviceFingerprint(device)
  const risk = await assessLoginRisk({ userType: subject.userType, userId: subject.userId, device, fingerprint })
  return { request, device, fingerprint, risk }
}

export async function selectMfaMethod(subject: MfaSubject, settings: any, methods = getMfaMethodAvailability(subject, settings)): Promise<MfaMethod> {
  if (settings?.defaultMethod === "totp" && methods.totp) return "totp"
  if (settings?.defaultMethod === "whatsapp" && methods.whatsapp) return "whatsapp"
  if (settings?.defaultMethod === "email" && methods.email) return "email"
  if (methods.totp) return "totp"
  if (methods.whatsapp) return "whatsapp"
  if (methods.email) return "email"
  if (methods.recovery) return "recovery"
  if (subject.userType === "customer" && subject.phone) return "whatsapp"
  return "email"
}

function retryMetadata(error: unknown) {
  const value = error as any
  return {
    retryAfterSeconds: Number(value?.retryAfterSeconds || 0) || null,
    cooldownUntil: typeof value?.cooldownUntil === "string" ? value.cooldownUntil : null,
  }
}

function providerContext(context: MfaRequestContext, failover = false) {
  return { ip: context.device.ip, fingerprint: context.fingerprint, failover }
}

function providerError(code: string, message: string, status = 503, metadata?: Record<string, unknown>) {
  const error = new Error(message)
  ;(error as any).code = code
  ;(error as any).status = status
  ;(error as any).metadata = metadata || {}
  return error
}

async function updateChallengeMetadata(challengeId: string, metadata: Record<string, unknown>, method?: MfaMethod) {
  await (prisma as any).mfaChallenge.update({
    where: { id: challengeId },
    data: {
      ...(method ? { method } : {}),
      metadata: metadata as any,
    },
  }).catch(() => null)
}

async function emergencyTrustedDeviceResult(input: {
  subject: MfaSubject
  challenge: { id: string; challengeToken: string; expiresAt: string }
  context: MfaRequestContext
  metadata: Record<string, unknown>
  reason: string
}) {
  const eligible = await findEmergencyTrustedDevice({
    request: input.context.request,
    subject: input.subject,
    fingerprint: input.context.fingerprint,
    device: input.context.device,
    risk: input.context.risk,
  })
  if (!eligible) return null

  const emergencyMetadata = {
    ...input.metadata,
    emergencyTrustedDevice: true,
    trustedDeviceId: eligible.trusted.id,
    recentMfaAt: eligible.recentMfaAt?.toISOString?.() || null,
    emergencyReason: input.reason,
    fallbackMessage: EMERGENCY_BYPASS_MESSAGE,
  }
  await updateChallengeMetadata(input.challenge.id, emergencyMetadata, "trusted_device")
  await logSecurityEvent({
    userType: input.subject.userType,
    userId: input.subject.userId,
    eventType: "admin_emergency_mfa_bypass_offered",
    device: input.context.device,
    riskLevel: input.context.risk.level,
    metadata: { trustedDeviceId: eligible.trusted.id, reason: input.reason },
  })
  return {
    bypass: true as const,
    method: "trusted_device" as const,
    challengeToken: input.challenge.challengeToken,
    expiresAt: input.challenge.expiresAt,
    otpExpiresAt: null,
    maskedTarget: "trusted device",
    fallbackMessage: EMERGENCY_BYPASS_MESSAGE,
    context: input.context,
    settings: null,
    availableMethods: { totp: false, whatsapp: false, email: false, recovery: false, trusted_device: true },
  }
}

async function sendOtpForChallenge(input: {
  subject: MfaSubject
  method: Extract<MfaMethod, "whatsapp" | "email">
  challengeId: string
  context: MfaRequestContext
}) {
  const variables = await buildNotificationVariables({
    first_name: firstName(input.subject.name),
    USER_NAME: input.subject.name || firstName(input.subject.name),
    otp_code: "",
    browser: input.context.device.browser,
    os: input.context.device.os,
    DEVICE: `${input.context.device.browser} on ${input.context.device.os}`,
    city: input.context.device.city || "Unknown",
    country: input.context.device.country || "Unknown",
    LOCATION: [input.context.device.city, input.context.device.country].filter(Boolean).join(", "),
    ip: input.context.device.ip,
    IP: input.context.device.ip,
    deviceType: input.context.device.deviceType,
    login_time: new Date().toLocaleString("en-IN"),
    TIME: new Date().toLocaleString("en-IN"),
  })
  if (input.method === "whatsapp" && input.subject.phone) {
    const session = await canSendWhatsAppSessionOtp()
    if (!session.ok) {
      await appendRuntimeLog("otp.log", "otp.whatsapp_unavailable", { reason: session.reason || null, status: session.status?.status || null })
      throw providerError(
        "mfa_whatsapp_unavailable",
        session.reason || "Evolution API is not ready. Check the configured server, instance, and API key.",
        503,
        {
          whatsappStatus: session.status?.status || null,
          runtimeStatus: session.status?.runtimeStatus || null,
          provider: "evolution",
          workerHeartbeatFresh: Boolean(session.status?.workerHeartbeatFresh),
        },
      )
    }
    const issued = await issueOtpCode({
      subject: input.subject,
      channel: "whatsapp",
      challengeId: input.challengeId,
      provider: "evolution",
      metadata: { riskLevel: input.context.risk.level },
      context: providerContext(input.context),
    })
    variables.otp_code = issued.otp
    ;(variables as any).otp = issued.otp
    const brandedOtpMessage = `${variables.SITE_NAME}\n\nYour verification code is:\n\n${issued.otp}\n\nThis code expires in 5 minutes.`
    ;(variables as any).brandedOtpMessage = brandedOtpMessage
    console.info("[WA] otp generated", { userType: input.subject.userType, userId: input.subject.userId, channel: "whatsapp" })
    await appendRuntimeLog("otp.log", "otp.generated", { userType: input.subject.userType, userId: input.subject.userId, channel: "whatsapp" })
    try {
      const result = await enqueueWhatsAppMessage({
        to: input.subject.phone,
        customerId: input.subject.userType === "customer" ? input.subject.userId : null,
        templateKey: WHATSAPP_TEMPLATE_KEYS.AUTH_LOGIN_OTP,
        variables,
        rawMessageText: brandedOtpMessage,
        category: "authentication",
        provider: "evolution",
        skipRegistrationCheck: true,
        metadata: {
          source: "mfa_login_whatsapp_otp",
          riskLevel: input.context.risk.level,
          challengeId: input.challengeId,
        },
      })
      await updateOtpProviderResult(issued.otpCodeId, "evolution", {
        challengeId: input.challengeId,
        provider: "evolution",
        providerMessageId: result.messageId,
        maskedTarget: result.toMasked,
        riskLevel: input.context.risk.level,
      })
      await appendRuntimeLog("otp.log", "otp.queued", { channel: "whatsapp", messageId: result.messageId || null })
      return { ...issued, method: "whatsapp" as const, maskedTarget: result.toMasked || maskPhone(input.subject.phone), provider: "evolution", fallbackMessage: null }
    } catch (error) {
      await appendRuntimeLog("otp.log", "otp.whatsapp_send_failed", { error: error instanceof Error ? error.message : String(error) })
      await updateOtpProviderResult(issued.otpCodeId, "evolution", {
        challengeId: input.challengeId,
        provider: "evolution",
        sendFailed: true,
        error: error instanceof Error ? error.message : String(error),
        riskLevel: input.context.risk.level,
      })
      throw providerError("mfa_whatsapp_send_failed", error instanceof Error ? error.message : "WhatsApp OTP delivery failed.", 502)
    }
  }
  return sendEmailOtpForChallenge({ ...input, variables })
}

async function sendEmailOtpForChallenge(input: {
  subject: MfaSubject
  method: Extract<MfaMethod, "whatsapp" | "email">
  challengeId: string
  context: MfaRequestContext
  variables: Record<string, any>
}) {
  const issued = await issueOtpCode({
    subject: input.subject,
    channel: "email",
    challengeId: input.challengeId,
    provider: "email",
    metadata: { riskLevel: input.context.risk.level },
    context: providerContext(input.context),
  })
  input.variables.otp_code = issued.otp
  input.variables.otp = issued.otp
  const emailResult = await sendTemplateEmail({
    templateKey: "email_verification",
    to: input.subject.email,
    throwOnError: true,
    variables: {
      ...input.variables,
      userName: input.subject.name || "there",
      otp: issued.otp,
      otp_code: issued.otp,
      code: issued.otp,
    } as any,
    metadata: { source: "mfa_login_email_otp", riskLevel: input.context.risk.level },
  })
  if (!(emailResult as any)?.success) throw new Error((emailResult as any)?.error || (emailResult as any)?.message || "Email OTP delivery failed.")
  await updateOtpProviderResult(issued.otpCodeId, "email", {
    challengeId: input.challengeId,
    provider: "email",
    maskedTarget: maskEmail(input.subject.email),
    riskLevel: input.context.risk.level,
  })
  await appendRuntimeLog("otp.log", "otp.email_sent", { challengeId: input.challengeId })
  return {
    ...issued,
    method: "email" as const,
    maskedTarget: maskEmail(input.subject.email),
    provider: "email",
    fallbackMessage: null,
  }
}

export async function beginMfaOrBypass(input: {
  request: NextRequest
  subject: MfaSubject
  preferredMethod?: MfaMethod
  context?: MfaRequestContext
  deliverableMethods?: ReturnType<typeof getMfaMethodAvailability>
}) {
  const settings = await ensureMfaSettings(input.subject)
  const context = input.context || await buildMfaContext(input.request, input.subject)

  const available = input.deliverableMethods || getMfaMethodAvailability(input.subject, settings)
  const challengeAvailable = { ...available }
  const preferred = input.preferredMethod && available[input.preferredMethod] ? input.preferredMethod : null
  const method = preferred || await selectMfaMethod(input.subject, settings, available)
  if (method === "trusted_device") throw new Error("Trusted-device emergency bypass is only available after OTP delivery fails.")
  if (method === "whatsapp" || method === "email") await assertOtpSendLimit(input.subject, method, providerContext(context))
  const now = new Date()
  const baseMetadata = {
    role: input.subject.role,
    email: input.subject.email,
    device: context.device,
    fingerprint: context.fingerprint,
    risk: context.risk,
    cooldownUntil: method === "whatsapp" || method === "email" ? new Date(Date.now() + RESEND_COOLDOWN_MS).toISOString() : null,
    otp_channel: method === "whatsapp" || method === "email" ? method : null,
    otp_attempts: 0,
    otpSendHistory: method === "whatsapp" || method === "email" ? [now.toISOString()] : [],
    attempts: 0,
  }
  const challenge = await createMfaChallenge({
    subject: input.subject,
    method,
    metadata: baseMetadata,
  })
  await appendRuntimeLog("mfa.log", "mfa.challenge_created", { userType: input.subject.userType, userId: input.subject.userId, method })
  let otpResult: Awaited<ReturnType<typeof sendOtpForChallenge>> | null = null
  try {
    otpResult = method === "whatsapp" || method === "email"
      ? await sendOtpForChallenge({ subject: input.subject, method, challengeId: challenge.id, context })
      : null
  } catch (error) {
    const retry = retryMetadata(error)
    const emergency = await emergencyTrustedDeviceResult({
      subject: input.subject,
      challenge,
      context,
    metadata: {
      ...baseMetadata,
      otpDeliveryFailed: true,
      failedMethod: method,
      failureMessage: error instanceof Error ? error.message : String(error),
      providerErrorCode: (error as any)?.code || null,
      providerMetadata: (error as any)?.metadata || null,
      retryAfterSeconds: retry.retryAfterSeconds,
      cooldownUntil: retry.cooldownUntil || baseMetadata.cooldownUntil,
    },
      reason: error instanceof Error ? error.message : String(error),
    })
    if (emergency) return emergency
    await appendRuntimeLog("mfa.log", "mfa.delivery_failed", { method, error: error instanceof Error ? error.message : String(error) })
    throw error
  }
  challengeAvailable.trusted_device = false
  await logSecurityEvent({ userType: input.subject.userType, userId: input.subject.userId, eventType: "mfa_challenge_created", device: context.device, riskLevel: context.risk.level, metadata: { method, reasons: context.risk.reasons } })
  return {
    bypass: false as const,
    method: otpResult?.method || method,
    challengeToken: challenge.challengeToken,
    expiresAt: challenge.expiresAt,
    otpExpiresAt: otpResult?.expiresAt || null,
    maskedTarget: otpResult?.maskedTarget || (method === "whatsapp" ? maskPhone(input.subject.phone) : maskEmail(input.subject.email)),
    fallbackMessage: otpResult?.fallbackMessage || null,
    context,
    settings,
    availableMethods: challengeAvailable,
  }
}

function maskPhone(phone?: string | null) {
  const value = String(phone || "")
  return value ? value.replace(/\d(?=\d{2})/g, "*") : null
}

function maskEmail(email?: string | null) {
  const [name, domain] = String(email || "").split("@")
  if (!name || !domain) return email || null
  return `${name.slice(0, 2)}***@${domain}`
}

export async function resendMfaOtp(input: { request: NextRequest; challenge: any; subject: MfaSubject }) {
  const method = String(input.challenge.method || "")
  if (method !== "whatsapp" && method !== "email") throw new Error("This MFA method cannot be resent.")
  const metadata = input.challenge.metadata || {}
  const cooldownUntil = metadata.cooldownUntil ? new Date(String(metadata.cooldownUntil)) : null
  if (cooldownUntil && cooldownUntil.getTime() > Date.now()) {
    const retryAfterSeconds = Math.ceil((cooldownUntil.getTime() - Date.now()) / 1000)
    const err = new Error(`Please wait ${retryAfterSeconds} seconds before requesting another code.`)
    ;(err as any).status = 429
    ;(err as any).code = "mfa_otp_cooldown"
    ;(err as any).retryAfterSeconds = retryAfterSeconds
    ;(err as any).cooldownUntil = cooldownUntil.toISOString()
    throw err
  }
  const context = await buildMfaContext(input.request, input.subject)
  await assertOtpSendLimit(input.subject, method as MfaMethod, providerContext(context))
  const history = [
    ...otpSendHistory(metadata).filter((time) => new Date(time).getTime() >= Date.now() - 60 * 60_000),
    new Date().toISOString(),
  ]
  await (prisma as any).mfaChallenge.update({
    where: { id: input.challenge.id },
    data: {
      metadata: {
        ...(metadata || {}),
        cooldownUntil: new Date(Date.now() + RESEND_COOLDOWN_MS).toISOString(),
        otp_channel: method,
        otp_attempts: 0,
        otpSendHistory: history,
      } as any,
    },
  })
  try {
    return await sendOtpForChallenge({ subject: input.subject, method: method as Extract<MfaMethod, "whatsapp" | "email">, challengeId: input.challenge.id, context })
  } catch (error) {
    const emergency = await emergencyTrustedDeviceResult({
      subject: input.subject,
      challenge: {
        id: input.challenge.id,
        challengeToken: "",
        expiresAt: input.challenge.expiresAt?.toISOString?.() || String(input.challenge.expiresAt || ""),
      },
      context,
      metadata: {
        ...(metadata || {}),
        otpDeliveryFailed: true,
        failedMethod: method,
        failureMessage: error instanceof Error ? error.message : String(error),
      },
      reason: error instanceof Error ? error.message : String(error),
    })
    if (emergency) return { method: "trusted_device" as const, maskedTarget: "trusted device", expiresAt: null, fallbackMessage: EMERGENCY_BYPASS_MESSAGE, otp: "", otpCodeId: "" }
    throw error
  }
}

export async function assertOtpChallenge(challenge: any, subject: MfaSubject, code: string) {
  const result = await verifyOtpChallengeDetailed(challenge, subject, code)
  return result.ok
}

export async function verifyOtpChallengeDetailed(challenge: any, subject: MfaSubject, code: string) {
  const method = String(challenge.method || "")
  if (method !== "whatsapp" && method !== "email") return { ok: false as const, code: "invalid_mfa_code", message: "Enter the 6-digit verification code.", status: 401 }
  const result = await verifyOtpCode({ subject, challengeId: challenge.id, channel: method, otp: code })
  if (result.ok) console.info("[WA] otp verified", { userType: subject.userType, userId: subject.userId, channel: method })
  return result
}

export function mfaChallengeFailure(challenge: any) {
  if (!challenge) return { code: "mfa_session_expired", message: "Session expired", status: 401 }
  if (new Date(challenge.expiresAt || 0).getTime() < Date.now()) return { code: "mfa_session_expired", message: "Session expired", status: 401 }
  const metadata = challenge.metadata && typeof challenge.metadata === "object" ? challenge.metadata : {}
  if (Number(metadata.attempts || 0) >= MAX_ATTEMPTS) return { code: "mfa_locked", message: "Too many attempts", status: 429 }
  if (challenge.method === "whatsapp" || challenge.method === "email") {
    return { code: "mfa_code_expired", message: "Expired code", status: 401 }
  }
  return { code: "invalid_mfa_code", message: "Invalid code", status: 401 }
}

export async function incrementMfaAttempt(challengeId: string) {
  const row = await (prisma as any).mfaChallenge.findUnique({ where: { id: challengeId } }).catch(() => null)
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {}
  await (prisma as any).mfaChallenge.update({
    where: { id: challengeId },
    data: { metadata: { ...metadata, attempts: Number(metadata.attempts || 0) + 1 } },
  }).catch(() => null)
}

export async function sendLoginSuccessAlert(subject: MfaSubject, context: MfaRequestContext) {
  if (!subject.phone) return
  const variables = await buildNotificationVariables({
    first_name: firstName(subject.name),
    USER_NAME: subject.name || firstName(subject.name),
    city: context.device.city || "Unknown",
    country: context.device.country || "Unknown",
    LOCATION: [context.device.city, context.device.country].filter(Boolean).join(", "),
    browser: context.device.browser,
    os: context.device.os,
    DEVICE: `${context.device.browser} on ${context.device.os}`,
    login_time: new Date().toLocaleString("en-IN"),
    TIME: new Date().toLocaleString("en-IN"),
  })
  await enqueueWhatsAppMessage({
    to: subject.phone,
    customerId: subject.userType === "customer" ? subject.userId : null,
    templateKey: WHATSAPP_TEMPLATE_KEYS.AUTH_LOGIN_SUCCESS,
    variables,
    category: "security",
    metadata: { source: "mfa_login_success", riskLevel: context.risk.level },
    skipRegistrationCheck: true,
  }).catch(() => null)
}
