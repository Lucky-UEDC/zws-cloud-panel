import type { WhatsAppSendJob } from "@/lib/whatsapp/queue"

export type WhatsAppProviderName = "evolution"

export type WhatsAppProviderCapabilities = {
  text: boolean
  media: boolean
  templates: boolean
  buttons: boolean
  groupInvites: boolean
  forceGroupJoin: false
}

export type NormalizedWhatsAppProviderJob = WhatsAppSendJob & {
  provider: WhatsAppProviderName
  complianceMode: "invite_only" | "template_send" | "session_send"
}

const PROVIDER_CAPABILITIES: Record<WhatsAppProviderName, WhatsAppProviderCapabilities> = {
  evolution: {
    text: true,
    media: true,
    templates: true,
    buttons: false,
    groupInvites: false,
    forceGroupJoin: false,
  },
}

export function normalizeWhatsAppProvider(value: unknown): WhatsAppProviderName {
  void value
  return "evolution"
}

export function getWhatsAppProviderCapabilities(provider: unknown = process.env.WHATSAPP_PROVIDER) {
  return PROVIDER_CAPABILITIES[normalizeWhatsAppProvider(provider)]
}

export function normalizeProviderJob(input: WhatsAppSendJob & { provider?: unknown }): NormalizedWhatsAppProviderJob {
  const provider = normalizeWhatsAppProvider(input.provider)
  const metadata = input.metadata || {}
  return {
    ...input,
    provider,
    complianceMode: metadata.inviteLink ? "invite_only" : input.templateKey ? "template_send" : "session_send",
    metadata: {
      ...metadata,
      provider,
      providerCapabilities: PROVIDER_CAPABILITIES[provider],
    },
  }
}

export function assertMetaSafeInviteFlow(input: { inviteLink?: string | null; forceJoin?: boolean | null }) {
  if (input.forceJoin) throw new Error("Unsafe WhatsApp group automation blocked: use invite links and optional admin approval only.")
  if (!input.inviteLink) throw new Error("Invite link is required for WhatsApp community/group onboarding.")
}
