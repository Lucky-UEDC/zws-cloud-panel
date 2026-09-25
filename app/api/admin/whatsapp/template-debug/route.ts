import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { noStoreHeaders, requireWhatsAppAdmin } from "../_shared"
import { resolveAndRenderWhatsAppTemplate, sampleVariables } from "@/lib/whatsapp/templates"
import { WHATSAPP_TEMPLATE_KEYS } from "@/lib/whatsapp/template-registry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseVariables(value: string | null) {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export async function GET(request: NextRequest) {
  await requireWhatsAppAdmin(request)
  const url = new URL(request.url)
  const key = url.searchParams.get("key") || WHATSAPP_TEMPLATE_KEYS.AUTH_LOGIN_OTP
  const language = url.searchParams.get("language") || "en"
  const templateVersionId = url.searchParams.get("versionId") || null
  const variables = parseVariables(url.searchParams.get("variables"))

  const template = await (prisma as any).whatsAppTemplate.findFirst({
    where: { OR: [{ key }, { slug: key }] },
    include: { versions: { orderBy: { version: "desc" }, take: 10 } },
  }).catch(() => null)
  const sample = template ? sampleVariables(template.templateVariables || template.variables || []) : {}
  const rendered = await resolveAndRenderWhatsAppTemplate({
    key,
    language,
    templateVersionId,
    variables: { ...sample, ...variables },
    fallbackKey: WHATSAPP_TEMPLATE_KEYS.SYSTEM_FALLBACK,
  })

  return NextResponse.json({
    ok: Boolean(rendered),
    selectedTemplate: rendered ? {
      id: rendered.templateId,
      key: rendered.templateKey,
      name: rendered.templateName,
      versionId: rendered.templateVersionId,
      version: rendered.templateVersion,
      language: rendered.language,
      category: rendered.category,
    } : null,
    requested: { key, language, templateVersionId },
    variables: { ...sample, ...variables },
    cacheHit: rendered?.cacheHit || false,
    renderDurationMs: rendered?.renderDurationMs ?? null,
    fallbackReason: rendered?.fallbackReason || null,
    finalRenderedBody: rendered?.message || "",
    body: rendered?.body || "",
    footer: rendered?.footer || null,
    buttons: rendered?.buttons || [],
    mediaUrl: rendered?.mediaUrl || null,
    versions: template?.versions || [],
  }, { headers: noStoreHeaders })
}
