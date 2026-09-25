import { NextRequest, NextResponse } from "next/server"
import { normalizeTemplateDraft, validateWhatsAppTemplate } from "@/lib/whatsapp/templates"
import { jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const body = await request.json().catch(() => ({}))
    const validation = validateWhatsAppTemplate(normalizeTemplateDraft(body.template || body))
    return NextResponse.json({
      ok: !validation.some((issue) => issue.level === "error"),
      validation,
    }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
