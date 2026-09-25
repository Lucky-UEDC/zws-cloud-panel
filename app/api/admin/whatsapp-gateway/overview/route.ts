import { NextResponse } from "next/server"
import { jsonError, noStoreHeaders, requireGatewayAdmin } from "../_shared"
import { prisma } from "@/lib/db"
import { getGatewaySettings, isGatewayConfigured, publicGatewaySettings } from "@/lib/whatsapp-gateway/settings"
import { countGatewayConnections, listGatewayWabas } from "@/lib/whatsapp-gateway/connections"
import { countGatewayTemplates } from "@/lib/whatsapp-gateway/templates"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    await requireGatewayAdmin(request)
    const settings = await getGatewaySettings()
    const [templateCount, contactCount, wabaList, counts, messageAgg] = await Promise.all([
      countGatewayTemplates(),
      prisma.whatsAppGatewayContact.count({ where: { provider: "whatsapp_gateway" } }),
      listGatewayWabas(),
      countGatewayConnections(),
      prisma.whatsAppGatewayMessage.aggregate({
        where: { provider: "whatsapp_gateway" },
        _count: true,
        _max: { createdAt: true },
      }),
    ])
    const byStatus = await prisma.whatsAppGatewayMessage.groupBy({
      by: ["status"],
      where: { provider: "whatsapp_gateway" },
      _count: { _all: true },
    })
    const last24h = await prisma.whatsAppGatewayMessage.count({
      where: { provider: "whatsapp_gateway", createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    })

    return NextResponse.json(
      {
        ok: true,
        overview: {
          configured: isGatewayConfigured(settings),
          settings: publicGatewaySettings(settings),
          counts: {
            wabas: counts.wabas,
            phoneNumbers: counts.phones,
            templates: templateCount,
            contacts: contactCount,
            messages: messageAgg._count,
            messages24h: last24h,
          },
          byStatus: byStatus.map((row) => ({ status: row.status, count: row._count._all })),
          wabas: wabaList,
          lastMessageAt: messageAgg._max.createdAt,
        },
      },
      { headers: noStoreHeaders },
    )
  } catch (error) {
    return jsonError(error)
  }
}