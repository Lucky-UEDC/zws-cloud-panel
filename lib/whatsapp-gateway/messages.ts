import { prisma } from "@/lib/db"
import { maskWhatsAppPhone, hashWhatsAppPhone } from "@/lib/whatsapp/diagnostics"
import { normalizeWhatsAppNumber } from "@/lib/whatsapp/format"
import type { Prisma } from "@prisma/client"

export type GatewayMessageRecord = {
  provider: string
  contactNo: string
  contactId?: string | null
  messageType: string
  message?: string | null
  mediaUrl?: string | null
  mediaName?: string | null
  mediaMimeType?: string | null
  location?: Prisma.InputJsonValue
  senderNumber?: string | null
  senderNumberId?: string | null
  wabaId?: string | null
  sentBy?: string | null
}

export type MessageListParams = {
  page?: number
  pageSize?: number
  status?: string
  messageType?: string
  phone?: string
  sender?: string
  contactId?: string
  from?: string
  to?: string
}

export type MessageListResult = {
  items: Array<{
    id: string
    contactNo: string
    maskedContact: string
    messageType: string
    message: string | null
    mediaName: string | null
    status: string
    httpStatus: number | null
    latencyMs: number | null
    sanitizedError: string | null
    sentBy: string | null
    createdAt: Date
  }>
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export async function createGatewayMessage(record: GatewayMessageRecord) {
  const digits = normalizeWhatsAppNumber(record.contactNo)?.digits || String(record.contactNo || "")
  return prisma.whatsAppGatewayMessage.create({
    data: {
      provider: record.provider,
      direction: "outbound",
      contactNo: digits,
      contactId: record.contactId ?? null,
      contactHash: hashWhatsAppPhone(digits),
      maskedContact: maskWhatsAppPhone(digits),
      messageType: record.messageType,
      message: record.message ?? null,
      mediaUrl: record.mediaUrl ?? null,
      mediaName: record.mediaName ?? null,
      mediaMimeType: record.mediaMimeType ?? null,
      location: (record.location ?? {}) as Prisma.InputJsonValue,
      senderNumber: record.senderNumber ?? null,
      senderNumberId: record.senderNumberId ?? null,
      wabaId: record.wabaId ?? null,
      sentBy: record.sentBy ?? null,
      status: "queued",
      providerResponse: {},
    },
  })
}

export async function updateGatewayMessage(id: string, patch: Prisma.WhatsAppGatewayMessageUpdateInput) {
  return prisma.whatsAppGatewayMessage.update({ where: { id }, data: patch })
}

export async function listGatewayMessages(params: MessageListParams = {}): Promise<MessageListResult> {
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20))

  const filters: Prisma.WhatsAppGatewayMessageWhereInput = {}
  if (params.status && params.status !== "all") filters.status = params.status
  if (params.messageType && params.messageType !== "all") filters.messageType = params.messageType
  if (params.sender) filters.senderNumber = params.sender
  if (params.contactId) filters.contactId = params.contactId
  if (params.phone) {
    const digits = normalizeWhatsAppNumber(params.phone)?.digits || params.phone
    filters.contactHash = hashWhatsAppPhone(digits)
  }
  if (params.from || params.to) {
    filters.createdAt = {
      ...(params.from ? { gte: new Date(params.from) } : {}),
      ...(params.to ? { lte: new Date(params.to) } : {}),
    }
  }
  const where: Prisma.WhatsAppGatewayMessageWhereInput = {
    provider: "whatsapp_gateway",
    ...(Object.keys(filters).length ? { AND: filters } : {}),
  }

  const [items, total] = await Promise.all([
    prisma.whatsAppGatewayMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        contactNo: true,
        maskedContact: true,
        messageType: true,
        message: true,
        mediaName: true,
        status: true,
        httpStatus: true,
        latencyMs: true,
        sanitizedError: true,
        sentBy: true,
        createdAt: true,
        contactId: true,
      },
    }),
    prisma.whatsAppGatewayMessage.count({ where }),
  ])

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  }
}

export function defaultMessageFilters() {
  return {
    status: "all",
    messageType: "all",
    phone: "",
    sender: "",
    from: "",
    to: "",
  }
}