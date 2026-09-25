import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { sendWhatsAppMessage } from "@/lib/whatsapp/queue"
import { resolveAndRenderWhatsAppTemplate, sampleVariables } from "@/lib/whatsapp/templates"
import { badRequest, jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../../../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWhatsAppAdmin(request)
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const phone = typeof body.phone === "string" ? body.phone.trim() : ""
    if (!phone) badRequest("Phone number is required.")

    const template = await (prisma as any).whatsAppTemplate.findUnique({ where: { id } })
    if (!template) badRequest("Template not found.")
    const variables = { ...sampleVariables(template.templateVariables || template.variables || []), ...(body.variables || {}) }
    const rendered = await resolveAndRenderWhatsAppTemplate({ key: template.key, variables })
    if (!rendered) throw new Error("Template could not be rendered.")
    if (rendered.message.length > 4000) badRequest("Rendered test message is too long.")

    const sent = await sendWhatsAppMessage({
      to: phone,
      category: template.category,
      templateKey: template.key,
      variables,
      metadata: {
        source: "admin_template_test",
        templateId: template.id,
        templateLanguage: rendered.language,
      },
    })
    return NextResponse.json({ ok: true, sent, preview: rendered }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
