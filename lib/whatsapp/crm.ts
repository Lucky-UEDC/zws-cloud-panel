import { prisma } from "@/lib/db"
import { decryptSecretValue, encryptSecretValue } from "@/lib/secret-crypto"
import { normalizeWhatsAppNumber, hashWhatsAppPhone, maskWhatsAppPhone, recordWhatsAppDeliveryAck, redactWhatsAppPayload, writeWhatsAppLog } from "@/lib/whatsapp/diagnostics"
import { sendWhatsAppMessage } from "@/lib/whatsapp/queue"

function text(value: unknown) {
  return String(value || "").trim()
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function model(name: string) {
  return (prisma as any)[name]
}

function safeDate(value: unknown) {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

export function normalizeCrmPhone(input: unknown) {
  const raw = text(input).replace(/@s\.whatsapp\.net$/i, "").replace(/@c\.us$/i, "").replace(/@g\.us$/i, "")
  try {
    const normalized = normalizeWhatsAppNumber(raw)
    return { phone: normalized.digits, phoneHash: normalized.phoneHash, maskedPhone: normalized.maskedPhone, jid: normalized.jid }
  } catch {
    const digits = raw.replace(/\D/g, "")
    if (!digits) return null
    return {
      phone: digits,
      phoneHash: hashWhatsAppPhone(digits),
      maskedPhone: maskWhatsAppPhone(digits),
      jid: `${digits}@c.us`,
    }
  }
}

function decryptPhone(row: any) {
  const encrypted = text(row?.phoneEncrypted || row?.phone_encrypted)
  if (!encrypted) return ""
  try {
    return decryptSecretValue(encrypted)
  } catch {
    return ""
  }
}

async function findCustomerForPhone(phone: string) {
  const variants = Array.from(new Set([phone, `+${phone}`, phone.replace(/^\+/, "")].filter(Boolean)))
  return prisma.customer.findFirst({
    where: { phone: { in: variants } },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      phoneVerified: true,
      whatsappOptIn: true,
      orders: { select: { id: true, status: true }, take: 20, orderBy: { createdAt: "desc" } },
      vpsInstances: { where: { deletedAt: null }, select: { id: true, name: true, status: true }, take: 20, orderBy: { createdAt: "desc" } },
    },
  }).catch(() => null)
}

export async function upsertWhatsAppContact(input: {
  phone: string
  maskedPhone?: string | null
  phoneHash?: string | null
  displayName?: string | null
  email?: string | null
  whatsappStatus?: string | null
  lastMessageAt?: Date | null
  lastMessagePreview?: string | null
  metadata?: Record<string, unknown>
}) {
  const normalized = normalizeCrmPhone(input.phone)
  if (!normalized) return null
  const customer = await findCustomerForPhone(normalized.phone)
  const data = {
    customerId: customer?.id || null,
    phoneEncrypted: encryptSecretValue(normalized.phone),
    maskedPhone: input.maskedPhone || normalized.maskedPhone,
    displayName: input.displayName || customer?.name || null,
    email: input.email || customer?.email || null,
    whatsappStatus: input.whatsappStatus || (customer?.whatsappOptIn ? "opted_in" : "unknown"),
    ...(input.lastMessageAt ? { lastMessageAt: input.lastMessageAt } : {}),
    ...(input.lastMessagePreview ? { lastMessagePreview: input.lastMessagePreview.slice(0, 1000) } : {}),
    metadata: { ...(input.metadata || {}), phoneVerified: customer?.phoneVerified ?? null } as any,
  }
  return model("whatsAppContact").upsert({
    where: { phoneHash: input.phoneHash || normalized.phoneHash },
    create: { phoneHash: input.phoneHash || normalized.phoneHash, ...data },
    update: data,
  }).catch(() => null)
}

export async function syncWhatsAppCustomerContacts(limit = 500) {
  const customers = await prisma.customer.findMany({
    where: { phone: { not: null } },
    select: { id: true, name: true, email: true, phone: true, whatsappOptIn: true, phoneVerified: true },
    orderBy: { updatedAt: "desc" },
    take: limit,
  }).catch(() => [])

  for (const customer of customers) {
    if (!customer.phone) continue
    const normalized = normalizeCrmPhone(customer.phone)
    if (!normalized) continue
    await model("whatsAppContact").upsert({
      where: { phoneHash: normalized.phoneHash },
      create: {
        customerId: customer.id,
        phoneHash: normalized.phoneHash,
        phoneEncrypted: encryptSecretValue(normalized.phone),
        maskedPhone: normalized.maskedPhone,
        displayName: customer.name,
        email: customer.email,
        whatsappStatus: customer.whatsappOptIn ? "opted_in" : "opted_out",
        metadata: { phoneVerified: customer.phoneVerified } as any,
      },
      update: {
        customerId: customer.id,
        phoneEncrypted: encryptSecretValue(normalized.phone),
        maskedPhone: normalized.maskedPhone,
        displayName: customer.name,
        email: customer.email,
        whatsappStatus: customer.whatsappOptIn ? "opted_in" : "opted_out",
        metadata: { phoneVerified: customer.phoneVerified } as any,
      },
    }).catch(() => null)
  }
  return { synced: customers.length }
}

export async function listWhatsAppContacts(input: { search?: string | null; pageSize?: number } = {}) {
  await syncWhatsAppCustomerContacts(500).catch(() => null)
  const query = text(input.search).toLowerCase()
  const pageSize = Math.min(200, Math.max(1, Number(input.pageSize || 100)))
  const where = query ? {
    OR: [
      { displayName: { contains: query, mode: "insensitive" } },
      { email: { contains: query, mode: "insensitive" } },
      { maskedPhone: { contains: query, mode: "insensitive" } },
    ],
  } : {}
  const contacts = await model("whatsAppContact").findMany({
    where,
    orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
    take: pageSize,
  }).catch(() => [])
  const customerIds = contacts.map((contact: any) => contact.customerId).filter(Boolean)
  const customers = customerIds.length ? await prisma.customer.findMany({
    where: { id: { in: customerIds } },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      orders: { select: { id: true, status: true }, take: 20 },
      vpsInstances: { where: { deletedAt: null }, select: { id: true, status: true }, take: 20 },
    },
  }).catch(() => []) : []
  const byCustomer = new Map(customers.map((customer) => [customer.id, customer]))
  return contacts.map((contact: any) => {
    const customer = contact.customerId ? byCustomer.get(contact.customerId) : null
    return {
      ...contact,
      phone: decryptPhone(contact) || contact.maskedPhone,
      orders: customer?.orders?.length || 0,
      services: customer?.vpsInstances?.length || 0,
      customer,
    }
  })
}

export async function upsertWhatsAppConversation(input: {
  phone: string
  direction?: string
  body?: string | null
  status?: string | null
  messageAt?: Date | null
  unreadIncrement?: number
}) {
  const normalized = normalizeCrmPhone(input.phone)
  if (!normalized) return null
  const contact = await upsertWhatsAppContact({
    phone: normalized.phone,
    phoneHash: normalized.phoneHash,
    maskedPhone: normalized.maskedPhone,
    lastMessageAt: input.messageAt || new Date(),
    lastMessagePreview: input.body || null,
  })
  return model("whatsAppConversation").upsert({
    where: { phoneHash: normalized.phoneHash },
    create: {
      contactId: contact?.id || null,
      customerId: contact?.customerId || null,
      phoneHash: normalized.phoneHash,
      maskedPhone: normalized.maskedPhone,
      status: input.status || "open",
      lastMessageAt: input.messageAt || new Date(),
      lastMessageText: input.body || null,
      unreadCount: input.direction === "inbound" ? Number(input.unreadIncrement || 1) : 0,
    },
    update: {
      contactId: contact?.id || null,
      customerId: contact?.customerId || null,
      maskedPhone: normalized.maskedPhone,
      lastMessageAt: input.messageAt || new Date(),
      lastMessageText: input.body || null,
      unreadCount: input.direction === "inbound" ? { increment: Number(input.unreadIncrement || 1) } : undefined,
    },
  }).catch(() => null)
}

export async function recordWhatsAppConversationMessage(input: {
  phone: string
  direction: "inbound" | "outbound"
  body?: string | null
  caption?: string | null
  status?: string | null
  messageType?: string | null
  mediaType?: string | null
  mediaUrl?: string | null
  providerMessageId?: string | null
  whatsappMessageId?: string | null
  messageLogId?: string | null
  rawPayload?: Record<string, unknown>
  createdAt?: Date | null
}) {
  const normalized = normalizeCrmPhone(input.phone)
  if (!normalized) return null
  const messageAt = input.createdAt || new Date()
  const body = input.body || input.caption || ""
  const conversation = await upsertWhatsAppConversation({
    phone: normalized.phone,
    direction: input.direction,
    body,
    messageAt,
  })
  if (!conversation) return null
  const row = await model("whatsAppConversationMessage").create({
    data: {
      conversationId: conversation.id,
      customerId: conversation.customerId || null,
      messageLogId: input.messageLogId || null,
      providerMessageId: input.providerMessageId || null,
      whatsappMessageId: input.whatsappMessageId || input.providerMessageId || null,
      direction: input.direction,
      status: input.status || (input.direction === "inbound" ? "received" : "sent"),
      messageType: input.messageType || input.mediaType || "text",
      mediaType: input.mediaType || null,
      mediaUrl: input.mediaUrl || null,
      body: body || null,
      caption: input.caption || null,
      phoneHash: normalized.phoneHash,
      maskedPhone: normalized.maskedPhone,
      rawPayload: (redactWhatsAppPayload(input.rawPayload || {}) || {}) as any,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  }).catch(() => null)
  return row
}

export async function listWhatsAppConversations(input: { search?: string | null; pageSize?: number } = {}) {
  const query = text(input.search)
  const pageSize = Math.min(200, Math.max(1, Number(input.pageSize || 100)))
  return model("whatsAppConversation").findMany({
    where: query ? {
      OR: [
        { maskedPhone: { contains: query, mode: "insensitive" } },
        { lastMessageText: { contains: query, mode: "insensitive" } },
      ],
    } : {},
    orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
    take: pageSize,
  }).catch(() => [])
}

export async function listWhatsAppConversationMessages(conversationId: string, pageSize = 100) {
  return model("whatsAppConversationMessage").findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: Math.min(300, Math.max(1, pageSize)),
  }).catch(() => [])
}

export async function listWhatsAppAutoReplyRules() {
  return model("whatsAppAutoReplyRule").findMany({
    orderBy: [{ enabled: "desc" }, { priority: "asc" }, { updatedAt: "desc" }],
    take: 200,
  }).catch(() => [])
}

export async function matchWhatsAppAutoReply(message: string) {
  const body = text(message).toLowerCase()
  if (!body) return null
  const rules = await listWhatsAppAutoReplyRules()
  return rules.find((rule: any) => {
    const keywords = array(rule.keywords).map((keyword) => text(keyword).toLowerCase()).filter(Boolean)
    if (!rule.enabled || !keywords.length) return false
    if (rule.matchMode === "exact") return keywords.some((keyword) => keyword === body)
    if (rule.matchMode === "starts_with") return keywords.some((keyword) => body.startsWith(keyword))
    return keywords.some((keyword) => body.includes(keyword))
  }) || null
}

export async function applyWhatsAppAutoReply(input: { phone: string; message: string; conversationMessageId?: string | null }) {
  const rule = await matchWhatsAppAutoReply(input.message)
  if (!rule) return null
  await model("whatsAppAutoReplyRule").update({
    where: { id: rule.id },
    data: { lastMatchedAt: new Date(), matchCount: { increment: 1 } },
  }).catch(() => null)
  const sent = await sendWhatsAppMessage({
    to: input.phone,
    provider: "evolution",
    skipRegistrationCheck: true,
    templateKey: "system_fallback",
    rawMessageText: rule.replyText,
    category: "transactional",
    metadata: { source: "auto_reply", autoReplyRuleId: rule.id, conversationMessageId: input.conversationMessageId || null },
  }).catch((error) => ({ ok: false as const, error: error?.message || String(error) }))
  if ((sent as any)?.ok) {
    await recordWhatsAppConversationMessage({
      phone: input.phone,
      direction: "outbound",
      body: rule.replyText,
      status: "sent",
      messageType: "text",
      providerMessageId: (sent as any).messageId || null,
      rawPayload: { source: "auto_reply", ruleId: rule.id },
    })
  }
  await writeWhatsAppLog({
    event: "auto_reply_matched",
    status: (sent as any)?.ok ? "sent" : "failed",
    phoneHash: normalizeCrmPhone(input.phone)?.phoneHash || null,
    maskedPhone: normalizeCrmPhone(input.phone)?.maskedPhone || null,
    message: rule.name,
    metadata: { ruleId: rule.id, sendResult: sent },
  })
  return { rule, sent }
}

function extractBody(message: any, data: any) {
  return text(
    data?.text ||
    data?.body ||
    data?.message?.conversation ||
    data?.message?.extendedTextMessage?.text ||
    data?.message?.imageMessage?.caption ||
    data?.message?.videoMessage?.caption ||
    data?.message?.documentMessage?.caption ||
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    message?.documentMessage?.caption ||
    message?.text ||
    message?.body ||
    message?.caption
  )
}

function mediaTypeFromMessage(message: any, data: any) {
  const type = text(data?.messageType || data?.type || data?.mediaType).toLowerCase()
  if (type) return type
  if (message?.imageMessage) return "image"
  if (message?.documentMessage) return "document"
  if (message?.audioMessage) return "audio"
  if (message?.videoMessage) return "video"
  if (message?.stickerMessage) return "sticker"
  return "text"
}

// Evolution API reports delivery/read receipts as string statuses (Baileys WAMessageStatus
// names), not the numeric ack codes this app's lifecycle tracking uses internally.
function evolutionStatusToAckNumber(status: string): number | null {
  switch (status.toUpperCase()) {
    case "ERROR":
      return -1
    case "PENDING":
      return 0
    case "SERVER_ACK":
      return 1
    case "DELIVERY_ACK":
      return 2
    case "READ":
      return 3
    case "PLAYED":
      return 4
    default:
      return null
  }
}

export function parseEvolutionWebhookPayload(payload: unknown) {
  const root = object(payload)
  const data = object(root.data || root.message || root.messages?.[0] || root)
  const key = object(data.key || data.message?.key)
  const message = object(data.message || data.messageData || root.message)
  const event = text(root.event || root.eventName || root.type || data.event || "message")
  const remoteJid = text(key.remoteJid || data.remoteJid || data.from || data.sender || data.senderJid || data.number || root.sender || root.from)
  const pushName = text(data.pushName || data.senderName || root.pushName || root.senderName)
  const fromMe = key.fromMe === true || data.fromMe === true || root.fromMe === true
  const phone = normalizeCrmPhone(remoteJid || data.number || root.number)
  // data.keyId is Evolution's flat form of key.id - it's what gets returned (and stored as
  // providerMessageId) when we send a message, so it must be checked before data.messageId
  // (which on status-update events is Evolution's own internal id, not ours).
  const providerMessageId = text(key.id || data.keyId || data.messageId || data.id || root.messageId || root.id)
  const mediaType = mediaTypeFromMessage(message, data)
  const body = extractBody(message, data)
  const timestamp = safeDate(data.messageTimestamp ? Number(data.messageTimestamp) * 1000 : data.timestamp || root.timestamp)
  const statusText = text(data.status || root.status)
  const ack = statusText ? evolutionStatusToAckNumber(statusText) : null
  const isStatusUpdate = /messages[._]update/i.test(event) && ack !== null
  return {
    event,
    phone,
    direction: fromMe ? "outbound" as const : "inbound" as const,
    providerMessageId,
    whatsappMessageId: providerMessageId,
    pushName,
    body,
    caption: body,
    mediaType,
    messageType: mediaType === "text" ? "text" : "media",
    mediaUrl: text(data.mediaUrl || data.url || message?.imageMessage?.url || message?.documentMessage?.url || message?.audioMessage?.url || message?.videoMessage?.url) || null,
    createdAt: timestamp,
    isStatusUpdate,
    ack,
    raw: root,
  }
}

export async function processEvolutionWebhook(payload: unknown) {
  const parsed = parseEvolutionWebhookPayload(payload)
  const event = await model("whatsAppWebhookEvent").create({
    data: {
      provider: "evolution",
      event: parsed.event,
      status: "received",
      providerMessageId: parsed.providerMessageId || null,
      whatsappMessageId: parsed.whatsappMessageId || null,
      phoneHash: parsed.phone?.phoneHash || null,
      maskedPhone: parsed.phone?.maskedPhone || null,
      direction: parsed.direction,
      payload: (redactWhatsAppPayload(parsed.raw) || {}) as any,
    },
  }).catch(() => null)

  if (parsed.isStatusUpdate && parsed.providerMessageId && parsed.ack !== null) {
    await recordWhatsAppDeliveryAck({
      providerMessageId: parsed.providerMessageId,
      ack: parsed.ack,
      providerResponse: parsed.raw as Record<string, unknown>,
    }).catch(() => null)
    if (event) {
      await model("whatsAppWebhookEvent").update({
        where: { id: event.id },
        data: { status: "processed", processedAt: new Date() },
      }).catch(() => null)
    }
    return { ok: true, eventId: event?.id || null, deliveryAck: true, ack: parsed.ack }
  }

  if (!parsed.phone) {
    if (event) {
      await model("whatsAppWebhookEvent").update({
        where: { id: event.id },
        data: { status: "ignored", errorMessage: "No phone number found", processedAt: new Date() },
      }).catch(() => null)
    }
    return { ok: true, ignored: true, reason: "missing_phone" }
  }
  await upsertWhatsAppContact({
    phone: parsed.phone.phone,
    phoneHash: parsed.phone.phoneHash,
    maskedPhone: parsed.phone.maskedPhone,
    displayName: parsed.pushName || null,
    lastMessageAt: parsed.createdAt || new Date(),
    lastMessagePreview: parsed.body || null,
  })
  const message = await recordWhatsAppConversationMessage({
    phone: parsed.phone.phone,
    direction: parsed.direction,
    body: parsed.body,
    caption: parsed.caption,
    status: parsed.direction === "inbound" ? "received" : "sent",
    messageType: parsed.messageType,
    mediaType: parsed.mediaType,
    mediaUrl: parsed.mediaUrl,
    providerMessageId: parsed.providerMessageId || null,
    whatsappMessageId: parsed.whatsappMessageId || null,
    rawPayload: parsed.raw,
    createdAt: parsed.createdAt,
  })
  if (event) {
    await model("whatsAppWebhookEvent").update({
      where: { id: event.id },
      data: { status: "processed", processedAt: new Date() },
    }).catch(() => null)
  }
  const autoReply = parsed.direction === "inbound" && parsed.body
    ? await applyWhatsAppAutoReply({ phone: parsed.phone.phone, message: parsed.body, conversationMessageId: message?.id || null }).catch((error) => ({ error: error?.message || String(error) }))
    : null
  return { ok: true, eventId: event?.id || null, messageId: message?.id || null, autoReply }
}

export async function getWhatsAppCrmOverview() {
  await syncWhatsAppCustomerContacts(500).catch(() => null)
  const [
    contacts,
    conversations,
    inbound,
    outbound,
    campaigns,
    templates,
    autoReplies,
    webhookEvents,
    recentMessages,
  ] = await Promise.all([
    model("whatsAppContact").count().catch(() => 0),
    model("whatsAppConversation").count().catch(() => 0),
    model("whatsAppConversationMessage").count({ where: { direction: "inbound" } }).catch(() => 0),
    model("whatsAppConversationMessage").count({ where: { direction: "outbound" } }).catch(() => 0),
    prisma.whatsAppCampaign.count().catch(() => 0),
    model("whatsAppTemplate").count().catch(() => 0),
    model("whatsAppAutoReplyRule").count({ where: { enabled: true } }).catch(() => 0),
    model("whatsAppWebhookEvent").count().catch(() => 0),
    model("whatsAppConversationMessage").findMany({ orderBy: { createdAt: "desc" }, take: 10 }).catch(() => []),
  ])
  return {
    metrics: { contacts, conversations, inbound, outbound, campaigns, templates, autoReplies, webhookEvents },
    recentMessages,
  }
}
