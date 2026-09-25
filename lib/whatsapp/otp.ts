import crypto from "node:crypto"
import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"
import { publicOrigin } from "@/lib/public-url"
import { enqueueWhatsAppOtp, sendWhatsAppMessage } from "@/lib/whatsapp/queue"
import { maskWhatsAppPhone, normalizeWhatsAppPhone } from "@/lib/whatsapp/format"
import { classifyWhatsAppError, writeWhatsAppErrorLog, writeWhatsAppLog } from "@/lib/whatsapp/diagnostics"
import { WHATSAPP_TEMPLATE_KEYS } from "@/lib/whatsapp/template-registry"
import { createWhatsAppGroupInvite, markWhatsAppGroupInviteSent, resolveWhatsAppGroupAssignment } from "@/lib/whatsapp/community"
import { createOtpCorrelationId, normalizeOtpError, WhatsAppOtpError } from "@/lib/whatsapp/otp-errors"
import { requireSecret } from "@/lib/security/env-secret"

const OTP_TTL_MS = 5 * 60_000
const OTP_COOLDOWN_MS = 60_000
const MAX_ATTEMPTS = 5
const MAX_SENDS_PER_HOUR = 5

function hashOtp(customerId: string, phone: string, otp: string) {
  return crypto.createHash("sha256")
    .update(`${customerId}:${phone}:${otp}:${requireSecret(["AUTH_SECRET", "NEXTAUTH_SECRET"], "zws")}`)
    .digest("hex")
}

export function generateWhatsAppOtp() {
  return String(crypto.randomInt(100000, 1000000))
}

function metadataRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

export async function sendCustomerPhoneOtp(input: { customerId: string; force?: boolean; templateKey?: string }) {
  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      metadata: true,
      whatsappOtpCooldownUntil: true,
      whatsappOtpSentAt: true,
    },
  })
  if (!customer) {
    throw new WhatsAppOtpError({ code: "customer_not_found", stage: "customer_lookup", status: 404, retryable: false })
  }
  if (!customer.phone) {
    throw new WhatsAppOtpError({ code: "phone_missing", stage: "customer_lookup", status: 400, retryable: false })
  }

  const phone = normalizeWhatsAppPhone(customer.phone)
  const otpCorrelationId = createOtpCorrelationId("customer_otp")
  const now = new Date()
  if (!input.force && customer.whatsappOtpCooldownUntil && customer.whatsappOtpCooldownUntil > now) {
    const retryAfterSeconds = Math.ceil((customer.whatsappOtpCooldownUntil.getTime() - now.getTime()) / 1000)
    const error = new Error(`Please wait ${retryAfterSeconds} seconds before requesting another OTP.`)
    ;(error as Error & { status?: number }).status = 429
    throw new WhatsAppOtpError({
      code: "rate_limited",
      stage: "rate_limit",
      message: error.message,
      status: 429,
      retryable: true,
      retryAfterSeconds,
    })
  }

  const metadata = metadataRecord(customer.metadata)
  const sends = Array.isArray(metadata.whatsappOtpSends) ? metadata.whatsappOtpSends : []
  const recentSends = sends
    .map((value) => new Date(String(value)).getTime())
    .filter((time) => Number.isFinite(time) && Date.now() - time < 60 * 60_000)

  if (!input.force && recentSends.length >= MAX_SENDS_PER_HOUR) {
    throw new WhatsAppOtpError({
      code: "rate_limited",
      stage: "rate_limit",
      message: "Too many OTP requests. Please try again later.",
      status: 429,
      retryable: true,
    })
  }

  const otp = generateWhatsAppOtp()
  const expiresAt = new Date(Date.now() + OTP_TTL_MS)
  const cooldownUntil = new Date(Date.now() + OTP_COOLDOWN_MS)

  await prisma.customer.update({
    where: { id: customer.id },
    data: {
      whatsappLastOtp: hashOtp(customer.id, phone, otp),
      whatsappOtpExpiresAt: expiresAt,
      whatsappOtpAttempts: 0,
      whatsappOtpSentAt: now,
      whatsappOtpCooldownUntil: cooldownUntil,
      metadata: {
        ...metadata,
        whatsappOtpSends: [...recentSends.map((time) => new Date(time).toISOString()), now.toISOString()],
        whatsappOtpCorrelationId: otpCorrelationId,
      } as any,
    },
  })

  await writeWhatsAppLog({
    event: "otp.generated",
    status: "queued",
    customerId: customer.id,
    maskedPhone: maskWhatsAppPhone(phone),
    metadata: { generatedAt: now.toISOString(), expiresAt: expiresAt.toISOString(), minutes: 5, otpCorrelationId },
  })

  await enqueueWhatsAppOtp({
    customerId: customer.id,
    phone,
    otp,
    minutes: 5,
    templateKey: input.templateKey || WHATSAPP_TEMPLATE_KEYS.AUTH_LOGIN_OTP,
    variables: {
      first_name: customer.name || "there",
      name: customer.name || "there",
      email: customer.email,
      otp_code: otp,
    },
    metadata: { otpCorrelationId, source: "customer_phone_otp" },
    generatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  }).catch(async (error) => {
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        whatsappLastOtp: null,
        whatsappOtpExpiresAt: null,
        whatsappOtpAttempts: 0,
        whatsappOtpCooldownUntil: null,
        metadata: {
          ...metadata,
          whatsappOtpCorrelationId: otpCorrelationId,
          whatsappOtpLastFailureAt: new Date().toISOString(),
        } as any,
      },
    }).catch(() => null)
    const classification = classifyWhatsAppError(error)
    await createPanelLog({
      category: "Email",
      level: "warn",
      message: "whatsapp_otp_queue_failed",
      customerId: customer.id,
      actorEmail: customer.email,
      metadata: { to: maskWhatsAppPhone(phone), error: error instanceof Error ? error.message : String(error), failureReason: classification.failureReason },
    }).catch(() => null)
    await writeWhatsAppErrorLog({ error, customerId: customer.id, maskedPhone: maskWhatsAppPhone(phone), metadata: { stage: "otp_enqueue" } })
    throw normalizeOtpError(error, "redis_queue")
  })

  return {
    ok: true as const,
    expiresAt: expiresAt.toISOString(),
    cooldownUntil: cooldownUntil.toISOString(),
    toMasked: maskWhatsAppPhone(phone),
    otpCorrelationId,
    deliveryStatus: "queued",
  }
}

export async function verifyCustomerPhoneOtp(input: { customerId: string; otp: string }) {
  const code = String(input.otp || "").replace(/\D/g, "")
  if (code.length !== 6) throw new Error("Enter the 6-digit OTP.")

  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    select: {
      id: true,
      phone: true,
      whatsappLastOtp: true,
      whatsappOtpExpiresAt: true,
      whatsappOtpAttempts: true,
    },
  })
  if (!customer?.phone || !customer.whatsappLastOtp || !customer.whatsappOtpExpiresAt) {
    throw new Error("No active WhatsApp OTP found.")
  }
  if (customer.whatsappOtpExpiresAt.getTime() < Date.now()) {
    throw new Error("OTP expired. Please request a new code.")
  }
  if (customer.whatsappOtpAttempts >= MAX_ATTEMPTS) {
    throw new Error("Too many failed OTP attempts. Please request a new code.")
  }

  const phone = normalizeWhatsAppPhone(customer.phone)
  const expected = hashOtp(customer.id, phone, code)
  if (expected !== customer.whatsappLastOtp) {
    await prisma.customer.update({
      where: { id: customer.id },
      data: { whatsappOtpAttempts: { increment: 1 } },
    })
    throw new Error("Invalid OTP.")
  }

  const updated = await prisma.customer.update({
    where: { id: customer.id },
    data: {
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
      whatsappLastOtp: null,
      whatsappOtpExpiresAt: null,
      whatsappOtpAttempts: 0,
      whatsappOtpCooldownUntil: null,
      whatsappOptIn: true,
    },
  })

  await enqueueVerifiedCustomerOnboardingInvite(updated.id).catch(async (error) => {
    await writeWhatsAppErrorLog({ error, customerId: updated.id, metadata: { stage: "otp_verified_group_onboarding" } }).catch(() => null)
  })

  return { ok: true as const, phoneVerified: true }
}

async function enqueueVerifiedCustomerOnboardingInvite(customerId: string) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      country: true,
      state: true,
      metadata: true,
      whatsappOptIn: true,
      phoneVerified: true,
    },
  })
  if (!customer?.phone || !customer.whatsappOptIn || !customer.phoneVerified) return null
  const metadata = metadataRecord(customer.metadata)
  if (metadata.whatsappOnboardingInviteSentAt) return null

  const assignment = await resolveWhatsAppGroupAssignment({
    country: customer.country || metadata.country,
    region: customer.state || metadata.region,
    language: metadata.language,
    service: metadata.service,
    plan: metadata.plan,
    product: metadata.product,
    campaignSource: metadata.campaignSource,
  })
  const group = assignment.group
  if (!group?.id || !group.inviteLink) return null

  const invite = await createWhatsAppGroupInvite({
    groupId: group.id,
    communityId: assignment.communityId || null,
    customerId: customer.id,
    inviteLink: group.inviteLink,
    approvalMode: group.approvalMode || "optional",
    generatedBy: "otp_onboarding",
    metadata: { routingRuleId: assignment.rule?.id || null },
  })

  const firstName = (customer.name || "there").split(/\s+/)[0] || "there"
  await sendWhatsAppMessage({
    to: customer.phone,
    customerId: customer.id,
    templateKey: WHATSAPP_TEMPLATE_KEYS.SYSTEM_FALLBACK,
    category: "onboarding",
    variables: {
      first_name: firstName,
      message_text: `Your account is verified. Join ${group.name} using this invite: ${group.inviteLink}`,
      dashboard_url: `${publicOrigin()}/client-area`,
    },
    metadata: {
      source: "otp_verified_group_onboarding",
      inviteId: invite.id,
      groupId: group.id,
      communityId: assignment.communityId || null,
      inviteLink: group.inviteLink,
      forcedJoin: false,
    },
  })

  await markWhatsAppGroupInviteSent({
    groupId: group.id,
    customerId: customer.id,
    phone: customer.phone,
    inviteId: invite.id,
    source: "otp_onboarding",
  })

  await prisma.customer.update({
    where: { id: customer.id },
    data: {
      metadata: {
        ...metadata,
        whatsappOnboardingInviteSentAt: new Date().toISOString(),
        whatsappOnboardingGroupId: group.id,
        whatsappOnboardingInviteId: invite.id,
      } as any,
    },
  })

  await writeWhatsAppLog({
    event: "onboarding.group_invite_queued",
    status: "queued",
    customerId: customer.id,
    maskedPhone: maskWhatsAppPhone(customer.phone),
    metadata: { groupId: group.id, inviteId: invite.id, forcedJoin: false },
  })

  return invite
}
