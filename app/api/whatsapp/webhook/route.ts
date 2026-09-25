import { NextRequest, NextResponse } from "next/server"
import { handleEvolutionWebhook } from "@/lib/whatsapp/evolution-webhook"

// Canonical Evolution webhook endpoint. `defaultEvolutionWebhookUrl()` registers the
// provider to POST here (`/api/whatsapp/webhook`) and that is the `destination` on real
// inbound payloads — but the handler previously lived only at the `/api/webhooks/evolution`
// alias, so this path 404'd and every delivery/read receipt was dropped.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({ ok: true, provider: "evolution", endpoint: "whatsapp_webhook" })
}

export async function POST(request: NextRequest) {
  return handleEvolutionWebhook(request)
}
