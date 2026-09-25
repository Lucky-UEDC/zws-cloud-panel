import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import {
  ensureDefaultWhatsAppTemplates,
  getWhatsAppTemplateAnalytics,
  invalidateWhatsAppTemplateCache,
  normalizeTemplateDraft,
  renderWhatsAppComponents,
  sampleVariables,
  seedWhatsAppTemplateVariables,
  snapshotWhatsAppTemplate,
  validateWhatsAppTemplate,
} from "@/lib/whatsapp/templates"
import { badRequest, jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

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

function templateSelect() {
  return {
    translations: { orderBy: { language: "asc" } },
    versions: { orderBy: { version: "desc" }, take: 8 },
  } as any
}

export async function GET(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    await seedWhatsAppTemplateVariables()

    const url = new URL(request.url)
    const category = text(url.searchParams.get("category"))
    const language = text(url.searchParams.get("language"))
    const status = text(url.searchParams.get("status"))
    const query = text(url.searchParams.get("q")).toLowerCase()

    const where: any = {}
    if (category && category !== "all") where.category = category
    if (language && language !== "all") where.language = language
    if (status && status !== "all") where.status = status
    if (query) {
      where.OR = [
        { name: { contains: query, mode: "insensitive" } },
        { slug: { contains: query, mode: "insensitive" } },
        { body: { contains: query, mode: "insensitive" } },
      ]
    }

    const [templates, variables, analytics] = await Promise.all([
      (prisma as any).whatsAppTemplate.findMany({
        where,
        include: templateSelect(),
        orderBy: [{ category: "asc" }, { name: "asc" }],
      }),
      (prisma as any).whatsAppTemplateVariable.findMany({ orderBy: [{ group: "asc" }, { key: "asc" }] }),
      getWhatsAppTemplateAnalytics(),
    ])

    return NextResponse.json({ ok: true, templates, variables, analytics }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)
    const body = await request.json().catch(() => ({}))

    if (body?.action === "reset_presets") {
      await ensureDefaultWhatsAppTemplates()
      await invalidateWhatsAppTemplateCache()
      const templates = await (prisma as any).whatsAppTemplate.findMany({ include: templateSelect(), orderBy: [{ category: "asc" }, { name: "asc" }] })
      return NextResponse.json({ ok: true, templates }, { headers: noStoreHeaders })
    }

    const draft = normalizeTemplateDraft({
      ...body,
      buttons: parseButtons(body.buttons),
      isActive: typeof body.isActive === "boolean" ? body.isActive : body.enabled,
    })
    if (!draft.key || !/^[a-z0-9_.-]+$/i.test(draft.key)) badRequest("Template key is required and may contain letters, numbers, dots, dashes, and underscores.")
    if (!draft.slug || !/^[a-z0-9_]+$/i.test(draft.slug)) badRequest("Template slug is required and may contain lowercase letters, numbers, and underscores.")
    if (!draft.name) badRequest("Template name is required.")
    if (!draft.body) badRequest("Template body is required.")

    const validation = validateWhatsAppTemplate(draft)
    if (validation.some((issue) => issue.level === "error")) {
      return NextResponse.json({ ok: false, error: "Template validation failed.", validation }, { status: 422, headers: noStoreHeaders })
    }

    const template = await (prisma as any).whatsAppTemplate.create({
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
        isSystem: false,
        isActive: draft.isActive !== false,
        enabled: draft.isActive !== false,
      },
      include: templateSelect(),
    })
    await snapshotWhatsAppTemplate(template.id, "admin", validation)
    await invalidateWhatsAppTemplateCache(template.key)

    return NextResponse.json({
      ok: true,
      template,
      validation,
      preview: renderWhatsAppComponents(draft, sampleVariables(draft.templateVariables)).message,
    }, { status: 201, headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
