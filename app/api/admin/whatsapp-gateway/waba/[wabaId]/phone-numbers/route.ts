import { NextResponse } from "next/server"
import { badRequest, jsonError, noStoreHeaders, requireGatewayAdmin } from "../../../_shared"
import { getGatewaySettings } from "@/lib/whatsapp-gateway/settings"
import { WhatsAppGatewayProvider } from "@/lib/whatsapp-gateway/client"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = { params: Promise<{ wabaId: string }> }

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireGatewayAdmin(request)
    const { wabaId } = await context.params
    if (!wabaId) return badRequest("WABA ID is required")
    const settings = await getGatewaySettings()
    if (!settings.apiBaseUrl) return badRequest("Gateway base URL is not configured")
    const provider = new WhatsAppGatewayProvider(settings)
    const phoneNumbers = await provider.getWabaPhoneNumbers(wabaId)
    return NextResponse.json({ ok: true, phoneNumbers }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}