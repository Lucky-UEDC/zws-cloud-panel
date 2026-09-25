import { NextRequest, NextResponse } from "next/server"
import { normalizeTemplateDraft, renderWhatsAppComponents, sampleVariables } from "@/lib/whatsapp/templates"
import { jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const body = await request.json().catch(() => ({}))
    const draft = normalizeTemplateDraft(body.template || body)
    const variables = { ...sampleVariables(draft.templateVariables), ...(body.variables || {}) }
    return NextResponse.json({ ok: true, preview: renderWhatsAppComponents(draft, variables) }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
