import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import {
  getWhatsAppTemplateAnalytics,
  invalidateWhatsAppTemplateCache,
  normalizeTemplateDraft,
  renderWhatsAppComponents,
  sampleVariables,
  snapshotWhatsAppTemplate,
  validateWhatsAppTemplate,
} from "@/lib/whatsapp/templates"
import { badRequest, jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseButtons(value: unknown) {
  if (Array.isArray(value)) return value
  if (typeof value !== "string" || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function getTemplate(id: string) {
  return (prisma as any).whatsAppTemplate.findUnique({
    where: { id },
    include: {
      translations: { orderBy: { language: "asc" } },
      versions: { orderBy: { version: "desc" }, take: 12 },
    },
  })
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWhatsAppAdmin(request)
    const { id } = await params
    const template = await getTemplate(id)
    if (!template) badRequest("Template not found.")
    const analytics = await getWhatsAppTemplateAnalytics(template.key)
    return NextResponse.json({ ok: true, template, analytics }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWhatsAppAdmin(request)
    const { id } = await params
    const existing = await getTemplate(id)
    if (!existing) badRequest("Template not found.")

    const body = await request.json().catch(() => ({}))
    if (body?.action === "restore_version") {
      const versionId = String(body.versionId || "")
      const version = await (prisma as any).whatsAppTemplateVersion.findUnique({ where: { id: versionId } })
      if (!version || version.templateId !== id) badRequest("Template version not found.")
      const restored = await (prisma as any).whatsAppTemplate.update({
        where: { id },
        data: {
          name: version.name,
          slug: version.slug,
          category: version.category,
          language: version.language,
          status: "draft",
          headerType: version.headerType,
          headerText: version.headerText,
          body: version.body,
          footer: version.footer,
          buttons: version.buttons,
          mediaUrl: version.mediaUrl,
          variables: version.templateVariables,
          templateVariables: version.templateVariables,
        },
        include: { translations: true, versions: { orderBy: { version: "desc" }, take: 12 } },
      })
      await snapshotWhatsAppTemplate(restored.id, "admin")
      await invalidateWhatsAppTemplateCache(restored.key)
      return NextResponse.json({ ok: true, template: restored }, { headers: noStoreHeaders })
    }

    const draft = normalizeTemplateDraft({
      key: body.key ?? existing.key,
      slug: body.slug ?? existing.slug,
      name: body.name ?? existing.name,
      category: body.category ?? existing.category,
      language: body.language ?? existing.language,
      status: body.status ?? existing.status,
      headerType: body.headerType ?? existing.headerType,
      headerText: body.headerText ?? existing.headerText,
      body: body.body ?? existing.body,
      footer: body.footer ?? existing.footer,
      buttons: body.buttons === undefined ? existing.buttons : parseButtons(body.buttons),
      mediaUrl: body.mediaUrl ?? existing.mediaUrl,
      isSystem: existing.isSystem,
      isActive: body.isActive ?? body.enabled ?? existing.isActive ?? existing.enabled,
    })
    const validation = validateWhatsAppTemplate(draft)
    if (validation.some((issue) => issue.level === "error")) {
      return NextResponse.json({ ok: false, error: "Template validation failed.", validation }, { status: 422, headers: noStoreHeaders })
    }

    const template = await (prisma as any).whatsAppTemplate.update({
      where: { id },
      data: {
        key: draft.key,
        slug: draft.slug,
        name: draft.name,
        category: draft.category,
        language: draft.language || "en",
        status: draft.status || "draft",
        headerType: draft.headerType || "none",
        headerText: draft.headerText || null,
        body: draft.body,
        footer: draft.footer || null,
        buttons: draft.buttons as any,
        mediaUrl: draft.mediaUrl || null,
        variables: draft.templateVariables as any,
        templateVariables: draft.templateVariables as any,
        isActive: draft.isActive !== false,
        enabled: draft.isActive !== false,
      },
      include: { translations: { orderBy: { language: "asc" } }, versions: { orderBy: { version: "desc" }, take: 12 } },
    })
    await snapshotWhatsAppTemplate(template.id, "admin", validation)
    await invalidateWhatsAppTemplateCache(template.key)
    return NextResponse.json({
      ok: true,
      template,
      validation,
      preview: renderWhatsAppComponents(draft, sampleVariables(draft.templateVariables)).message,
    }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWhatsAppAdmin(request)
    const { id } = await params
    const template = await getTemplate(id)
    if (!template) badRequest("Template not found.")
    if (template.isSystem) {
      await (prisma as any).whatsAppTemplate.update({ where: { id }, data: { isActive: false, enabled: false, status: "archived" } })
    } else {
      await (prisma as any).whatsAppTemplate.delete({ where: { id } })
    }
    await invalidateWhatsAppTemplateCache(template.key)
    return NextResponse.json({ ok: true }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
