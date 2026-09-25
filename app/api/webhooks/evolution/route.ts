import { NextRequest } from "next/server"
import { handleEvolutionWebhook } from "@/lib/whatsapp/evolution-webhook"

// Legacy compatibility alias for the Evolution inbound webhook. Canonical path is
// `/api/whatsapp/webhook`; both share one handler in lib/whatsapp/evolution-webhook.ts.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  return handleEvolutionWebhook(request)
}
