import { NextRequest, NextResponse } from "next/server"
import { getEvolutionSettings } from "@/lib/whatsapp/evolution"
import { processEvolutionWebhook } from "@/lib/whatsapp/crm"

async function verifyWebhook(request: NextRequest) {
  const settings = await getEvolutionSettings().catch(() => null)
  const expected = settings?.webhookSecret || process.env.WHATSAPP_WEBHOOK_SECRET || ""
  if (!expected) {
    if (process.env.WHATSAPP_WEBHOOK_STRICT === "1") {
      console.warn("[whatsapp-webhook] rejecting request: webhook secret is not configured and WHATSAPP_WEBHOOK_STRICT=1")
      return false
    }
    console.warn("[whatsapp-webhook] accepting unauthenticated request: no webhook secret configured. Set WHATSAPP_WEBHOOK_SECRET and WHATSAPP_WEBHOOK_STRICT=1 in production.")
    return true
  }
  const candidates = [
    request.headers.get("x-webhook-secret"),
    request.headers.get("x-evolution-secret"),
    request.headers.get("x-hub-signature"),
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""),
  ].map((value) => String(value || "").trim()).filter(Boolean)
  return candidates.includes(expected)
}

// Shared handler for the Evolution inbound webhook. Used by both the canonical path
// (`/api/whatsapp/webhook`, where the provider is actually registered to POST) and the
// legacy compatibility alias (`/api/webhooks/evolution`).
export async function handleEvolutionWebhook(request: NextRequest) {
  if (!(await verifyWebhook(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }
  const payload = await request.json().catch(() => ({}))
  const result = await processEvolutionWebhook(payload)
  return NextResponse.json(result)
}
