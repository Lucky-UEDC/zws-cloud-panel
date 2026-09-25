import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { invalidateWhatsAppTemplateCache, normalizeTemplateDraft, validateWhatsAppTemplate } from "@/lib/whatsapp/templates"
import { badRequest, jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../../../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWhatsAppAdmin(request)
    const { id } = await params
    const template = await (prisma as any).whatsAppTemplate.findUnique({ where: { id } })
    if (!template) badRequest("Template not found.")
    const body = await request.json().catch(() => ({}))
    const draft = normalizeTemplateDraft({
      ...template,
      ...body,
      key: template.key,
      slug: template.slug,
      name: template.name,
      category: template.category,
      isActive: template.isActive,
    })
    const validation = validateWhatsAppTemplate(draft)
    if (validation.some((issue) => issue.level === "error")) {
      return NextResponse.json({ ok: false, error: "Translation validation failed.", validation }, { status: 422, headers: noStoreHeaders })
    }

    const translation = await (prisma as any).whatsAppTemplateTranslation.upsert({
      where: { templateId_language: { templateId: id, language: draft.language || "en" } },
      update: {
        status: draft.status || "draft",
        headerText: draft.headerText || null,
        body: draft.body,
        footer: draft.footer || null,
        buttons: draft.buttons as any,
        mediaUrl: draft.mediaUrl || null,
        templateVariables: draft.templateVariables as any,
      },
      create: {
        templateId: id,
        language: draft.language || "en",
        status: draft.status || "draft",
        headerText: draft.headerText || null,
        body: draft.body,
        footer: draft.footer || null,
        buttons: draft.buttons as any,
        mediaUrl: draft.mediaUrl || null,
        templateVariables: draft.templateVariables as any,
      },
    })
    await invalidateWhatsAppTemplateCache(template.key)
    return NextResponse.json({ ok: true, translation, validation }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
