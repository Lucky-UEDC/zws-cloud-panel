import { prisma } from "@/lib/db"
import { normalizeWhatsAppNumber } from "@/lib/whatsapp/format"
import { WhatsAppGatewayProvider } from "@/lib/whatsapp-gateway/client"
import { maskWhatsAppPhone } from "@/lib/whatsapp/diagnostics"
import type { GatewayContact } from "@/lib/whatsapp-gateway/types"
import { WhatsAppGatewayError } from "@/lib/whatsapp-gateway/errors"

export type GatewayContactInput = {
  phoneNumber: string
  name?: string
  email?: string
  createdBy?: string | null
}

export function normalizeGatewayPhone(input: string): { digits: string; e164: string | null } {
  const parsed = normalizeWhatsAppNumber(input)
  const digits = parsed?.digits || String(input || "").replace(/\D/g, "")
  const e164 = digits ? `+${digits}` : null
  return { digits, e164 }
}

export async function upsertGatewayContact(input: GatewayContactInput) {
  const { digits, e164 } = normalizeGatewayPhone(input.phoneNumber)
  if (!digits) throw new WhatsAppGatewayError("Phone number is required", { code: "INVALID_PHONE" })

  const existing = await prisma.whatsAppGatewayContact.findFirst({
    where: { provider: "whatsapp_gateway", phoneNumber: digits },
  })
  if (existing) {
    return prisma.whatsAppGatewayContact.update({
      where: { id: existing.id },
      data: {
        name: input.name || existing.name,
        email: input.email || existing.email,
        createdBy: existing.createdBy ?? input.createdBy ?? null,
      },
    })
  }
  return prisma.whatsAppGatewayContact.create({
    data: {
      provider: "whatsapp_gateway",
      name: input.name || null,
      phoneNumber: digits,
      phoneE164: e164,
      email: input.email || null,
      createdBy: input.createdBy ?? null,
      metadata: {},
    },
  })
}

export type GatewayContactListParams = {
  page?: number
  pageSize?: number
  search?: string
}

export type GatewayContactListResult = {
  items: Array<{ id: string; name: string | null; phoneNumber: string; maskedPhone: string; email: string | null; createdAt: Date; messageCount: bigint | number }>
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export async function listGatewayContacts(params: GatewayContactListParams = {}): Promise<GatewayContactListResult> {
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20))

  const where: Record<string, unknown> = { provider: "whatsapp_gateway" }
  if (params.search) {
    where.OR = [
      { phoneNumber: { contains: params.search.replace(/\D/g, ""), mode: "insensitive" } },
      { name: { contains: params.search, mode: "insensitive" } },
      { email: { contains: params.search, mode: "insensitive" } },
    ]
  }

  const [raw, total] = await Promise.all([
    prisma.whatsAppGatewayContact.findMany({
      where: where as any,
      include: { _count: { select: { messages: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.whatsAppGatewayContact.count({ where: where as any }),
  ])

  return {
    items: raw.map((contact) => {
      const count = (contact as any)._count?.messages
      return {
        id: contact.id,
        name: contact.name,
        phoneNumber: contact.phoneNumber,
        maskedPhone: maskWhatsAppPhone(contact.phoneNumber),
        email: contact.email,
        createdAt: contact.createdAt,
        messageCount: count ?? 0,
      }
    }),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  }
}

export async function findGatewayContactByPhone(phoneNumber: string) {
  const { digits } = normalizeGatewayPhone(phoneNumber)
  if (!digits) return null
  return prisma.whatsAppGatewayContact.findFirst({ where: { provider: "whatsapp_gateway", phoneNumber: digits } })
}

export function attachContactIdFactory() {
  return {
    async resolve(phoneNumber: string, name?: string, email?: string, createdBy?: string | null): Promise<{ contactId: string | null; digits: string }> {
      const { digits } = normalizeGatewayPhone(phoneNumber)
      if (!digits) return { contactId: null, digits: phoneNumber }
      const existing = await prisma.whatsAppGatewayContact.findFirst({ where: { provider: "whatsapp_gateway", phoneNumber: digits } })
      if (existing) return { contactId: existing.id, digits }
      try {
        const created = await prisma.whatsAppGatewayContact.create({
          data: {
            provider: "whatsapp_gateway",
            name: name || null,
            phoneNumber: digits,
            phoneE164: digits ? `+${digits}` : null,
            email: email || null,
            createdBy: createdBy ?? null,
            metadata: {},
          },
        })
        return { contactId: created.id, digits }
      } catch {
        return { contactId: null, digits }
      }
    },
  }
}

export async function syncGatewayContacts(provider: WhatsAppGatewayProvider): Promise<{ synced: number; failed: number }> {
  let synced = 0
  let failed = 0
  try {
    const contacts = await provider.listContacts()
    for (const contact of contacts) {
      try {
        await upsertContactFromProvider(contact)
        synced += 1
      } catch {
        failed += 1
      }
    }
  } catch {
    failed += 1
  }
  return { synced, failed }
}

export async function upsertContactFromProvider(contact: GatewayContact) {
  const { digits } = normalizeGatewayPhone(contact.phone || "")
  if (!digits) return null
  const existing = await prisma.whatsAppGatewayContact.findFirst({ where: { provider: "whatsapp_gateway", phoneNumber: digits } })
  if (existing) {
    return prisma.whatsAppGatewayContact.update({
      where: { id: existing.id },
      data: {
        externalId: contact.id || existing.externalId,
        name: contact.name || existing.name,
        email: contact.email || existing.email,
      },
    })
  }
  return prisma.whatsAppGatewayContact.create({
    data: {
      provider: "whatsapp_gateway",
      externalId: contact.id || null,
      name: contact.name || null,
      phoneNumber: digits,
      phoneE164: digits ? `+${digits}` : null,
      email: contact.email || null,
      metadata: {},
    },
  })
}