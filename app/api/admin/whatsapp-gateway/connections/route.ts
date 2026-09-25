import { NextResponse } from "next/server"
import { badRequest, jsonError, noStoreHeaders, requireGatewayAdmin } from "../_shared"
import { getGatewaySettings } from "@/lib/whatsapp-gateway/settings"
import { WhatsAppGatewayProvider } from "@/lib/whatsapp-gateway/client"
import { countGatewayConnections, listGatewayPhoneNumbers, listGatewayWabas, syncGatewayConnections } from "@/lib/whatsapp-gateway/connections"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    await requireGatewayAdmin(request)
    const [wabas, phoneNumbers, counts] = await Promise.all([listGatewayWabas(), listGatewayPhoneNumbers(), countGatewayConnections()])
    return NextResponse.json({ ok: true, connections: wabas, phoneNumbers, counts }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request) {
  try {
    await requireGatewayAdmin(request)
    const settings = await getGatewaySettings()
    if (!settings.apiBaseUrl) return badRequest("Gateway base URL is not configured")
    const provider = new WhatsAppGatewayProvider(settings)
    const result = await syncGatewayConnections(provider, settings)
    return NextResponse.json({ ok: true, result }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}