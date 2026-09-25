import { NextRequest, NextResponse } from "next/server"
import { getEvolutionSettings, testEvolutionConnection } from "@/lib/whatsapp/evolution"
import { jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const current = await getEvolutionSettings()
    const body = await request.json().catch(() => ({}))
    const settings = {
      ...current,
      serverUrl: body.serverUrl ?? current.serverUrl,
      instanceId: body.instanceId ?? current.instanceId,
      instanceName: body.instanceId ?? body.instanceName ?? current.instanceName,
      apiKey: /^\*{6,}$/.test(String(body.apiKey || "")) ? current.apiKey : String(body.apiKey ?? (current.apiKey || "")),
    }
    const result = await testEvolutionConnection(settings)
    return NextResponse.json({ ok: true, result }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
