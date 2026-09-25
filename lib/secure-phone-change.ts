import crypto from "node:crypto"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db"
import { getRedisClient } from "@/lib/redis"
import { WHATSAPP_TEMPLATE_KEYS } from "@/lib/whatsapp/template-registry"
import { sendWhatsAppMessage } from "@/lib/whatsapp/queue"
import { maskWhatsAppPhone, normalizeWhatsAppPhone } from "@/lib/whatsapp/format"
import { revokeSessionsForUser } from "@/lib/auth/session-store"
import { sendTemplateEmail } from "@/lib/email/send-mail"
import { requireSecret } from "@/lib/security/env-secret"

const TTL_SECONDS = 10 * 60
const MAX_ATTEMPTS = 5

type PhoneSubjectType = "customer" | "admin"

type PhoneChangeState = {
  oldPhone: string
  newPhone?: string | null
  oldHash?: string | null
  newHash?: string | null
  oldVerified: boolean
  newVerified: boolean
  oldAttempts: number
  newAttempts: number
  passwordVerified: boolean
  createdAt: string
}

function key(type: PhoneSubjectType, id: string) {
  return `secure-phone-change:${type}:${id}`
}

function secret() {
  return requireSecret(["AUTH_SECRET", "NEXTAUTH_SECRET"], "zws")
}

function hashOtp(type: PhoneSubjectType, id: string, phone: string, otp: string) {
  return crypto.createHash("sha256").update(`${type}:${id}:${phone}:${otp}:${secret()}`).digest("hex")
}

function otp() {
  return String(crypto.randomInt(100000, 1000000))
}

async function redis() {
  const client = getRedisClient()
  if (!client) {
    const error = new Error("Phone verification requires Redis.")
    ;(error as Error & { status?: number }).status = 503
    throw error
  }
  await client.connect().catch(() => undefined)
  return client
}

async function readState(type: PhoneSubjectType, id: string): Promise<PhoneChangeState | null> {
  const client = await redis()
  const raw = await client.get(key(type, id))
  return raw ? JSON.parse(raw) as PhoneChangeState : null
}

async function writeState(type: PhoneSubjectType, id: string, state: PhoneChangeState) {
  const client = await redis()
  await client.set(key(type, id), JSON.stringify(state), "EX", TTL_SECONDS)
}

async function clearState(type: PhoneSubjectType, id: string) {
  const client = await redis()
  await client.del(key(type, id))
}

async function sendOtp(input: { type: PhoneSubjectType; id: string; phone: string; code: string; name?: string | null; email?: string | null }) {
  await sendWhatsAppMessage({
    to: input.phone,
    templateKey: WHATSAPP_TEMPLATE_KEYS.AUTH_LOGIN_OTP,
    variables: {
      first_name: input.name || "there",
      name: input.name || "there",
      email: input.email || "",
      otp_code: input.code,
      phone: maskWhatsAppPhone(input.phone),
    },
    category: "auth",
    skipRegistrationCheck: true,
    metadata: { source: "secure_phone_change", subjectType: input.type, subjectId: input.id },
  })
}

async function sendPhoneChangeAlert(input: { type: PhoneSubjectType; id: string; oldPhone: string; newPhone: string; email?: string | null; name?: string | null }) {
  const variables = {
    first_name: input.name || "there",
    userName: input.name || "there",
    old_phone: maskWhatsAppPhone(input.oldPhone),
    new_phone: maskWhatsAppPhone(input.newPhone),
    message_text: `Phone number changed from ${maskWhatsAppPhone(input.oldPhone)} to ${maskWhatsAppPhone(input.newPhone)}.`,
  }
  await Promise.allSettled([
    sendWhatsAppMessage({ to: input.oldPhone, templateKey: WHATSAPP_TEMPLATE_KEYS.SECURITY_ALERT, variables, category: "security", skipRegistrationCheck: true, metadata: { source: "phone_change_alert_old", subjectType: input.type, subjectId: input.id } }),
    sendWhatsAppMessage({ to: input.newPhone, templateKey: WHATSAPP_TEMPLATE_KEYS.SECURITY_ALERT, variables, category: "security", skipRegistrationCheck: true, metadata: { source: "phone_change_alert_new", subjectType: input.type, subjectId: input.id } }),
    input.email ? sendTemplateEmail({
      templateKey: "password_changed",
      to: input.email,
      variables: {
        ...variables,
        subject: "Phone number changed",
        message: variables.message_text,
      } as any,
      metadata: { source: "phone_change_alert_email", subjectType: input.type, subjectId: input.id },
    }) : Promise.resolve(null),
  ])
}

export async function startOldPhoneVerification(input: {
  type: PhoneSubjectType
  id: string
  phone: string | null | undefined
  hashedPassword: string | null | undefined
  password: string
  name?: string | null
  email?: string | null
}) {
  if (!input.phone) throw new Error("Current phone number is missing.")
  if (!input.hashedPassword || !await bcrypt.compare(String(input.password || ""), input.hashedPassword)) {
    throw Object.assign(new Error("Current password is required."), { status: 403 })
  }
  const phone = normalizeWhatsAppPhone(input.phone)
  const code = otp()
  const state: PhoneChangeState = {
    oldPhone: phone,
    oldHash: hashOtp(input.type, input.id, phone, code),
    oldVerified: false,
    newVerified: false,
    oldAttempts: 0,
    newAttempts: 0,
    passwordVerified: true,
    createdAt: new Date().toISOString(),
  }
  await writeState(input.type, input.id, state)
  await sendOtp({ ...input, phone, code })
  return { ok: true as const, step: "old_sent", toMasked: maskWhatsAppPhone(phone) }
}

export async function verifyOldPhone(input: { type: PhoneSubjectType; id: string; otp: string }) {
  const state = await readState(input.type, input.id)
  const code = String(input.otp || "").replace(/\D/g, "")
  if (!state?.oldHash || code.length !== 6) throw new Error("Old phone verification is required.")
  if (state.oldAttempts >= MAX_ATTEMPTS) throw new Error("Too many failed attempts. Start again.")
  if (hashOtp(input.type, input.id, state.oldPhone, code) !== state.oldHash) {
    await clearState(input.type, input.id)
    throw new Error("Invalid OTP.")
  }
  await writeState(input.type, input.id, { ...state, oldVerified: true, oldHash: null, oldAttempts: 0 })
  return { ok: true as const, step: "old_verified" }
}

export async function startNewPhoneVerification(input: {
  type: PhoneSubjectType
  id: string
  phone: string
  name?: string | null
  email?: string | null
}) {
  const state = await readState(input.type, input.id)
  if (!state?.oldVerified || !state.passwordVerified) throw new Error("Verify the old number and password first.")
  const phone = normalizeWhatsAppPhone(input.phone)
  const code = otp()
  const next = {
    ...state,
    newPhone: phone,
    newHash: hashOtp(input.type, input.id, phone, code),
    newVerified: false,
    newAttempts: 0,
  }
  await writeState(input.type, input.id, next)
  await sendOtp({ ...input, phone, code })
  return { ok: true as const, step: "new_sent", toMasked: maskWhatsAppPhone(phone) }
}

export async function verifyNewPhoneAndCommit(input: { type: PhoneSubjectType; id: string; otp: string }) {
  const state = await readState(input.type, input.id)
  const code = String(input.otp || "").replace(/\D/g, "")
  if (!state?.oldVerified || !state.passwordVerified || !state.newPhone || !state.newHash || code.length !== 6) {
    throw new Error("New phone verification is required.")
  }
  if (state.newAttempts >= MAX_ATTEMPTS) throw new Error("Too many failed attempts. Start again.")
  if (hashOtp(input.type, input.id, state.newPhone, code) !== state.newHash) {
    await clearState(input.type, input.id)
    throw new Error("Invalid OTP.")
  }

  let subject: { email?: string | null; name?: string | null } | null = null
  if (input.type === "customer") {
    subject = await prisma.customer.update({
      where: { id: input.id },
      data: {
        phone: state.newPhone,
        phoneVerified: true,
        phoneVerifiedAt: new Date(),
        whatsappOptIn: true,
        whatsappLastOtp: null,
        whatsappOtpExpiresAt: null,
        whatsappOtpAttempts: 0,
        whatsappOtpCooldownUntil: null,
      },
      select: { email: true, name: true },
    })
  } else {
    subject = await prisma.adminProfile.update({
      where: { id: input.id },
      data: { phone: state.newPhone, phoneVerified: true, phoneVerifiedAt: new Date() },
      select: { email: true, displayName: true },
    })
  }

  await revokeSessionsForUser(input.id, input.type === "customer" ? "client" : undefined)
  await (prisma as any).userTrustedDevice.updateMany({ where: { userType: input.type, userId: input.id, revokedAt: null }, data: { revokedAt: new Date() } }).catch(() => null)
  await prisma.authChallenge.updateMany({ where: { userType: input.type, userId: input.id, consumedAt: null }, data: { consumedAt: new Date() } }).catch(() => null)
  await sendPhoneChangeAlert({
    type: input.type,
    id: input.id,
    oldPhone: state.oldPhone,
    newPhone: state.newPhone,
    email: subject?.email || null,
    name: (subject as any)?.name || (subject as any)?.displayName || null,
  }).catch(() => null)
  await clearState(input.type, input.id)
  return { ok: true as const, step: "phone_updated", phone: state.newPhone, toMasked: maskWhatsAppPhone(state.newPhone) }
}
