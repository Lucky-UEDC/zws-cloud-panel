import { NextResponse } from "next/server"
import { jsonError, jsonOk, noStoreHeaders, rateLimitGateway, requireGatewayAdmin, badRequest } from "../_shared"
import { getGatewaySettings } from "@/lib/whatsapp-gateway/settings"
import { WhatsAppGatewayProvider } from "@/lib/whatsapp-gateway/client"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    await requireGatewayAdmin(request)
    rateLimitGateway(request, 30, 60_000)

    const settings = await getGatewaySettings()
    if (!settings.apiBaseUrl) return badRequest("Gateway base URL is not configured")

    const provider = new WhatsAppGatewayProvider(settings)
    const result = await provider.testConnection()
    return NextResponse.json({ ok: true, result }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}