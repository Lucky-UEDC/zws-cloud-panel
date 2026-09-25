import { NextRequest, NextResponse } from "next/server"
import { getEvolutionSettings, publicEvolutionSettings, updateEvolutionSettings } from "@/lib/whatsapp/evolution"
import { getBaseUrl } from "@/lib/runtime-site-url"
import { jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../_shared"
import { getAdminFromCookies } from "@/lib/server-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const settings = await getEvolutionSettings()
    const webhookUrl = `${getBaseUrl(request)}/api/webhooks/evolution`
    return NextResponse.json({ ok: true, settings: { ...publicEvolutionSettings(settings), webhookUrl } }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const admin = await getAdminFromCookies()
    const body = await request.json().catch(() => ({}))
    const result = await updateEvolutionSettings({
      serverUrl: body.serverUrl,
      instanceId: body.instanceId,
      instanceName: body.instanceId || body.instanceName,
      instanceToken: body.instanceToken,
      apiKey: body.apiKey,
      webhookUrl: `${getBaseUrl(request)}/api/webhooks/evolution`,
      webhookSecret: body.webhookSecret,
      testRecipient: body.testRecipient,
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      failsafe: body.failsafe && typeof body.failsafe === "object" ? body.failsafe : undefined,
    }, String(admin?.email || "admin"))
    return NextResponse.json({ ok: true, settings: { ...result.settings, webhookUrl: `${getBaseUrl(request)}/api/webhooks/evolution` } }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
