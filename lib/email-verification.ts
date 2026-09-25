import crypto from "node:crypto"
import { prisma } from "@/lib/db"
import { sendTemplateEmail } from "@/lib/email/send-mail"
import { sendNotification } from "@/lib/notifications/service"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

const TOKEN_BYTES = 32
const TOKEN_TTL_HOURS = 24

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex")
}

function safeRedirectTo(value: string | null | undefined, baseUrl: string) {
  const raw = String(value || "").trim()
  if (!raw) return null
  try {
    const parsed = raw.startsWith("/") ? new URL(raw, baseUrl) : new URL(raw)
    const base = new URL(baseUrl)
    if (parsed.origin !== base.origin) return null
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return raw.startsWith("/") ? raw : null
  }
}

export async function createEmailVerificationToken(input: {
  userId: string
  redirectTo?: string | null
}) {
  const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url")
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000)
  const site = await getPublicSiteSettings()

  const record = await prisma.emailVerificationToken.create({
    data: {
      userId: input.userId,
      tokenHash,
      expiresAt,
      redirectTo: safeRedirectTo(input.redirectTo, site.siteUrl),
    },
  })

  return {
    token,
    tokenHash,
    expiresAt,
    redirectTo: record.redirectTo,
    verifyUrl: `${site.siteUrl}/verify-email?token=${encodeURIComponent(token)}`,
  }
}

export async function sendVerificationEmail(input: {
  userId: string
  redirectTo?: string | null
  reason?: string
}) {
  const customer = await prisma.customer.findUnique({ where: { id: input.userId } })
  if (!customer?.email) return { success: false as const, status: "skipped" as const, message: "Customer not found" }
  if (customer.emailVerifiedAt) return { success: true as const, status: "already_verified" as const }

  const token = await createEmailVerificationToken({ userId: customer.id, redirectTo: input.redirectTo })
  const site = await getPublicSiteSettings()
  return sendNotification({
    type: "otp",
    channels: ["email", "whatsapp"],
    user: {
      id: customer.id,
      email: customer.email,
      phone: customer.phone,
      name: customer.name,
    },
    data: {
      templateKey: "email_verification",
      userName: customer.name || "there",
      email: customer.email,
      verifyUrl: token.verifyUrl,
      clientAreaUrl: site.clientAreaUrl,
      appUrl: site.siteUrl,
      brandName: site.brandName,
      metadata: {
        reason: input.reason || "email_verification",
        redirectTo: token.redirectTo,
        expiresAt: token.expiresAt.toISOString(),
      },
    },
  })
}

export async function verifyEmailToken(token: string) {
  const tokenHash = hashToken(String(token || ""))
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    include: { customer: true },
  })

  if (!record) return { ok: false as const, code: "invalid", message: "This verification link is invalid." }
  if (record.usedAt) {
    return {
      ok: true as const,
      alreadyUsed: true,
      customer: record.customer,
      redirectTo: record.redirectTo,
      message: "Your email is already verified.",
    }
  }
  if (record.expiresAt.getTime() < Date.now()) {
    return {
      ok: false as const,
      code: "expired",
      customer: record.customer,
      redirectTo: record.redirectTo,
      message: "This verification link has expired.",
    }
  }

  const now = new Date()
  const result = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: now },
    })
    const used = await tx.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: now },
    })
    return { customer, used }
  })

  const site = await getPublicSiteSettings()
  await sendTemplateEmail({
    templateKey: "email_verified",
    to: result.customer.email,
    variables: {
      userName: result.customer.name || "there",
      email: result.customer.email,
      clientAreaUrl: site.clientAreaUrl,
      appUrl: site.siteUrl,
    },
    customerId: result.customer.id,
    metadata: { verificationTokenId: record.id },
  }).catch(() => null)

  return {
    ok: true as const,
    customer: result.customer,
    redirectTo: result.used.redirectTo,
    message: "Your email has been verified.",
  }
}

export function emailVerificationRedirect(value?: string | null) {
  const raw = String(value || "").trim()
  return raw.startsWith("/") ? raw : "/client-area"
}
