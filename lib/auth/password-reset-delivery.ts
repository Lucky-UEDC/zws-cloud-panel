import { getEmailConfig } from "@/lib/email/config"
import { sendTemplateEmail } from "@/lib/email/send-mail"
import { createPanelLog } from "@/lib/panel-log"
import { getSiteUrl } from "@/lib/settings/site-settings"
import { getEvolutionSettings } from "@/lib/whatsapp/evolution"
import { normalizeWhatsAppNumber } from "@/lib/whatsapp/format"
import { sendWhatsAppText } from "@/lib/whatsapp/send"

export const PASSWORD_RESET_EXPIRES_MINUTES = 15

export type PasswordResetCustomer = {
  id: string
  email: string
  name?: string | null
  phone?: string | null
  whatsappOptIn?: boolean | null
}

function isSmtpConfigured(config: Awaited<ReturnType<typeof getEmailConfig>>) {
  return Boolean(config?.enabled && config.smtpHost && config.smtpUser && config.smtpPass && config.fromEmail)
}

async function isWhatsAppConfigured() {
  const settings = await getEvolutionSettings().catch(() => null)
  return Boolean(settings?.serverUrl && settings.instanceId && settings.apiKey)
}

function resetMessage(resetUrl: string) {
  return [
    "Password Reset",
    "",
    "Click:",
    resetUrl,
    "",
    `Expires in ${PASSWORD_RESET_EXPIRES_MINUTES} minutes.`,
  ].join("\n")
}

export async function buildPasswordResetUrl(token: string) {
  const appUrl = await getSiteUrl()
  return `${appUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`
}

export async function deliverPasswordResetLink(input: {
  customer: PasswordResetCustomer
  token: string
  source: string
  requestedBy?: string | null
  expiresAt: Date
}) {
  const resetUrl = await buildPasswordResetUrl(input.token)
  const smtp = await getEmailConfig().catch(() => null)
  const metadata = { source: input.source, requestedBy: input.requestedBy || null, expiresAt: input.expiresAt.toISOString(), resetChannel: null as string | null }

  if (isSmtpConfigured(smtp)) {
    const sent = await sendTemplateEmail({
      templateKey: "password_reset",
      to: input.customer.email,
      variables: {
        userName: input.customer.name || "there",
        email: input.customer.email,
        resetUrl,
      },
      customerId: input.customer.id,
      metadata: { ...metadata, resetChannel: "email" },
    })
    return { channel: "email" as const, status: sent.status, resetUrl, warning: null as string | null }
  }

  const phone = input.customer.whatsappOptIn === false ? "" : String(input.customer.phone || "").trim()
  if (phone && await isWhatsAppConfigured()) {
    try {
      const normalized = normalizeWhatsAppNumber(phone)
      const sent = await sendWhatsAppText({
        to: normalized.digits,
        message: resetMessage(resetUrl),
        customerId: input.customer.id,
        templateKey: "auth_password_reset",
        category: "transactional",
        metadata: { ...metadata, resetChannel: "whatsapp" },
      })
      return { channel: "whatsapp" as const, status: sent.status, resetUrl, warning: null as string | null }
    } catch {
      // Fall through to the no-channel warning below.
    }
  }

  const warning = "No SMTP or WhatsApp reset channel is configured for this customer."
  await createPanelLog({
    category: "Email",
    level: "warn",
    message: "password_reset_delivery_unavailable",
    actorType: input.requestedBy ? "admin" : "system",
    actorEmail: input.requestedBy || null,
    customerId: input.customer.id,
    metadata: { ...metadata, resetChannel: "none", hasPhone: Boolean(input.customer.phone), whatsappOptIn: input.customer.whatsappOptIn !== false },
  }).catch(() => null)
  return { channel: "none" as const, status: "skipped" as const, resetUrl, warning }
}
