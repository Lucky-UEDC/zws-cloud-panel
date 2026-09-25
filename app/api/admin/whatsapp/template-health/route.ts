import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import {
  getWhatsAppTemplateCacheStatus,
  validateWhatsAppRequiredTemplates,
} from "@/lib/whatsapp/templates"
import { jsonError, noStoreHeaders, rateLimitWhatsAppDiagnostics, requireWhatsAppAdmin } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    await requireWhatsAppAdmin(request)
    rateLimitWhatsAppDiagnostics(request, 60)

    const [validation, cache, renderLogs, failures] = await Promise.all([
      validateWhatsAppRequiredTemplates(),
      getWhatsAppTemplateCacheStatus(),
      (prisma as any).whatsAppLog.findMany({
        where: { event: { in: ["template.fallback_used", "template.resolve_failed", "otp.template_missing"] } },
        orderBy: { createdAt: "desc" },
        take: 20,
      }).catch(() => []),
      (prisma as any).whatsAppErrorLog.findMany({
        where: { failureReason: { in: ["template_missing", "provider_error"] } },
        orderBy: { createdAt: "desc" },
        take: 10,
      }).catch(() => []),
    ])

    return NextResponse.json({
      ok: validation.ok,
      required: validation.required,
      missing: validation.missing,
      cache,
      lastRenderStatus: renderLogs[0] || null,
      renderFailures: renderLogs,
      failures,
    }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error)
  }
}
