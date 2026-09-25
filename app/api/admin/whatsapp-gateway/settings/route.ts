import { NextResponse } from "next/server"
import { badRequest, jsonError, jsonOk, noStoreHeaders, requireGatewayAdmin } from "../_shared"
import { getGatewaySettings, isGatewayConfigured, publicGatewaySettings, updateGatewaySettings } from "@/lib/whatsapp-gateway/settings"
import { gatewaySettingsSchema } from "@/lib/whatsapp-gateway/validate"
import { getAdminFromCookies } from "@/lib/server-auth"
import { gatewayLoggingEnabled, logGatewayEvent } from "@/lib/whatsapp-gateway/audit"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    await requireGatewayAdmin(request)
    const settings = await getGatewaySettings()
    const publicSettings = publicGatewaySettings(settings)
    return NextResponse.json(
      { ok: true, settings: publicSettings, configured: isGatewayConfigured(settings) },
      { headers: noStoreHeaders },
    )
  } catch (error) {
    return jsonError(error)
  }
}

export async function PUT(request: Request) {
  try {
    await requireGatewayAdmin(request)
    const body = await request.json().catch(() => badRequest("Invalid JSON body"))
    const admin = await getAdminFromCookies()
    const parsed = gatewaySettingsSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return badRequest(issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid settings")
    }

    const input = parsed.data
    if (input.enabled && !input.apiBaseUrl && String((body as { apiBaseUrl?: unknown })?.apiBaseUrl ?? "") === "") {
      const existing = await getGatewaySettings()
      if (!existing.apiBaseUrl) return badRequest("A base URL is required before enabling the gateway")
    }

    const updated = await updateGatewaySettings(input, admin?.email ?? null)
    const current = await getGatewaySettings()
    if (gatewayLoggingEnabled(current)) {
      void logGatewayEvent({
        settings: current,
        level: "info",
        message: `WhatsApp Gateway settings updated by ${admin?.email ?? "admin"}`,
        metadata: { enabled: current.enabled, authType: current.authType, baseUrl: current.apiBaseUrl },
        actorEmail: admin?.email,
      })
    }
    return NextResponse.json({ ok: true, settings: updated }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function OPTIONS() {
  return NextResponse.json({ ok: true }, { status: 204, headers: noStoreHeaders })
}