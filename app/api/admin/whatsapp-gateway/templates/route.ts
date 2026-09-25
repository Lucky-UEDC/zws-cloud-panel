import { NextResponse } from "next/server"
import { badRequest, jsonError, noStoreHeaders, requireGatewayAdmin } from "../_shared"
import { getGatewaySettings } from "@/lib/whatsapp-gateway/settings"
import { WhatsAppGatewayProvider } from "@/lib/whatsapp-gateway/client"
import { createGatewayTemplate, listGatewayTemplates } from "@/lib/whatsapp-gateway/templates"
import { gatewayTemplateSchema } from "@/lib/whatsapp-gateway/validate"
import { getAdminFromCookies } from "@/lib/server-auth"
import type { TemplateDraft } from "@/lib/whatsapp-gateway/types"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    await requireGatewayAdmin(request)
    const url = new URL(request.url)
    const result = await listGatewayTemplates({
      page: Number(url.searchParams.get("page") || 1),
      pageSize: Number(url.searchParams.get("pageSize") || 20),
      search: url.searchParams.get("search") || undefined,
      category: url.searchParams.get("category") || undefined,
      status: url.searchParams.get("status") || undefined,
      wabaId: url.searchParams.get("wabaId") || undefined,
    })
    return NextResponse.json({ ok: true, ...result }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request) {
  try {
    await requireGatewayAdmin(request)
    const settings = await getGatewaySettings()
    const body = await request.json().catch(() => badRequest("Invalid JSON body"))
    const parsed = gatewayTemplateSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return badRequest(issue ? `${issue.path.join(".") || "template"}: ${issue.message}` : "Invalid template")
    }
    if (!settings.apiBaseUrl) return badRequest("Gateway base URL is not configured")
    if (!settings.enabled) return badRequest("WhatsApp Gateway is not enabled")

    const provider = new WhatsAppGatewayProvider(settings)
    const admin = await getAdminFromCookies()
    const draft: TemplateDraft = parsed.data as unknown as TemplateDraft
    const template = await createGatewayTemplate({ draft, provider, createdBy: admin?.email ?? null })

    return NextResponse.json(
      { ok: true, template: { id: template.id, templateName: template.templateName, status: template.status, sanitizedError: template.sanitizedError } },
      { headers: noStoreHeaders },
    )
  } catch (error) {
    return jsonError(error, "Template could not be submitted")
  }
}