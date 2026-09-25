import { prisma } from "@/lib/db"
import { WhatsAppGatewayProvider } from "@/lib/whatsapp-gateway/client"
import type { WhatsAppGatewaySettings } from "@/lib/whatsapp-gateway/settings"
import { WhatsAppGatewayError } from "@/lib/whatsapp-gateway/errors"

export type SyncResult = {
  success: boolean
  wabasSynced: number
  phoneNumbersSynced: number
  message: string
}

export async function syncGatewayConnections(provider: WhatsAppGatewayProvider, settings: WhatsAppGatewaySettings): Promise<SyncResult> {
  const now = new Date()
  let wabas = 0
  let phones = 0

  try {
    const connections = await provider.getConnections()
    if (!connections.length) throw new WhatsAppGatewayError("No WhatsApp connections found", { code: "NO_CONNECTIONS" })
    for (const connection of connections) {
      const upserted = await prisma.whatsAppGatewayWaba.upsert({
        where: { provider_externalId: { provider: "whatsapp_gateway", externalId: connection.id } },
        create: {
          provider: "whatsapp_gateway",
          externalId: connection.id,
          name: connection.name || null,
          whatsappBusinessAccountId: connection.whatsappBusinessAccountId || null,
          isActive: connection.isActive,
          lastSyncedAt: now,
        },
        update: {
          name: connection.name,
          whatsappBusinessAccountId: connection.whatsappBusinessAccountId,
          isActive: connection.isActive,
          lastSyncedAt: now,
        },
      })
      if (upserted) wabas += 1

      let wabaPhones: Array<{ phoneNumberId: string; displayPhoneNumber?: string }> = []
      try {
        wabaPhones = await provider.getWabaPhoneNumbers(connection.id)
      } catch {
        wabaPhones = []
      }
      for (const phone of wabaPhones) {
        await prisma.whatsAppGatewayPhoneNumber.upsert({
          where: { provider_externalId: { provider: "whatsapp_gateway", externalId: phone.phoneNumberId } },
          create: {
            provider: "whatsapp_gateway",
            externalId: phone.phoneNumberId,
            wabaId: upserted.id,
            wabaExternalId: connection.id,
            displayPhoneNumber: phone.displayPhoneNumber || null,
            isActive: true,
            lastSyncedAt: now,
          },
          update: {
            wabaId: upserted.id,
            wabaExternalId: connection.id,
            displayPhoneNumber: phone.displayPhoneNumber,
            isActive: true,
            lastSyncedAt: now,
          },
        })
        phones += 1
      }
    }

    const allExternalIds = new Set<string>(connections.map((connection) => connection.id))
    const saved = await prisma.whatsAppGatewayWaba.findMany({
      where: { provider: "whatsapp_gateway" },
      select: { id: true, externalId: true },
    })
    const staleWabas = saved.filter((waba) => !allExternalIds.has(waba.externalId))
    if (staleWabas.length) {
      await prisma.whatsAppGatewayPhoneNumber.updateMany({
        where: { provider: "whatsapp_gateway", wabaId: { in: staleWabas.map((waba) => waba.id) } },
        data: { isActive: false },
      })
      await prisma.whatsAppGatewayWaba.updateMany({
        where: { id: { in: staleWabas.map((waba) => waba.id) } },
        data: { isActive: false },
      })
    }

    return { success: true, wabasSynced: wabas, phoneNumbersSynced: phones, message: `Synced ${wabas} connection(s) and ${phones} phone number(s)` }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection sync failed"
    return { success: false, wabasSynced: wabas, phoneNumbersSynced: phones, message }
  }
}

export async function listGatewayWabas(options: { includeInactive?: boolean } = {}) {
  return prisma.whatsAppGatewayWaba.findMany({
    where: { provider: "whatsapp_gateway", ...(!options.includeInactive ? { isActive: true } : {}) },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, whatsappBusinessAccountId: true, externalId: true, isActive: true, lastSyncedAt: true },
  })
}

export async function listGatewayPhoneNumbers() {
  return prisma.whatsAppGatewayPhoneNumber.findMany({
    where: { provider: "whatsapp_gateway", isActive: true },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      externalId: true,
      displayPhoneNumber: true,
      isPrimary: true,
      wabaId: true,
      lastSyncedAt: true,
      waba: { select: { name: true, whatsappBusinessAccountId: true } },
    },
  })
}

export async function findGatewayPhoneNumberByExternalId(externalId: string) {
  return prisma.whatsAppGatewayPhoneNumber.findUnique({
    where: { provider_externalId: { provider: "whatsapp_gateway", externalId } },
  })
}

export async function countGatewayConnections() {
  const [wabas, phones] = await Promise.all([
    prisma.whatsAppGatewayWaba.count({ where: { provider: "whatsapp_gateway", isActive: true } }),
    prisma.whatsAppGatewayPhoneNumber.count({ where: { provider: "whatsapp_gateway", isActive: true } }),
  ])
  return { wabas, phones }
}