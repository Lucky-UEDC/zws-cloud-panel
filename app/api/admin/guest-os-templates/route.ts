import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { createPanelLog } from "@/lib/panel-log"
import { GUEST_OPERATIONS, GUEST_ENGINES, GUEST_SHELLS, GUEST_COMMAND_TYPES, GUEST_DANGER_LEVELS, GUEST_VERIFICATION_PARSERS, GUEST_ERROR_MESSAGES } from "@/lib/guest-automation/constants"
import { GUEST_PLACEHOLDERS } from "@/lib/guest-automation/placeholders"
import {
  createGuestTemplate,
  draftFromPayload,
  guestTemplateHealth,
  guestTestMatrix,
  listGuestTemplates,
  structuralIssues,
  TemplateValidationError,
} from "@/lib/guest-automation/admin-templates"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache", Expires: "0" }

/**
 * The guest-automation template catalogue.
 *
 * Named `/api/admin/guest-os-templates` rather than folded into
 * `/api/admin/os-templates`, which is the Proxmox template catalogue with a
 * different shape and a different audience. Merging them would mean one path
 * returning two unrelated payloads depending on a query parameter, and the
 * existing consumers of that path are working today.
 */
export async function GET(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const view = new URL(request.url).searchParams.get("view") || "list"
  if (view === "health") {
    return NextResponse.json({ success: true, health: await guestTemplateHealth() }, { headers: NO_CACHE_HEADERS })
  }
  if (view === "matrix") {
    return NextResponse.json({ success: true, matrix: await guestTestMatrix() }, { headers: NO_CACHE_HEADERS })
  }
  if (view === "vocabulary") {
    // Everything the editor needs to build a valid command, sent from the same
    // place that validates it, so the dropdowns cannot drift from the rules.
    return NextResponse.json({
      success: true,
      vocabulary: {
        operations: GUEST_OPERATIONS,
        engines: GUEST_ENGINES,
        shells: GUEST_SHELLS,
        commandTypes: GUEST_COMMAND_TYPES,
        dangerLevels: GUEST_DANGER_LEVELS,
        verificationParsers: GUEST_VERIFICATION_PARSERS,
        placeholders: GUEST_PLACEHOLDERS,
        errorMessages: GUEST_ERROR_MESSAGES,
      },
    }, { headers: NO_CACHE_HEADERS })
  }

  return NextResponse.json({ success: true, templates: await listGuestTemplates() }, { headers: NO_CACHE_HEADERS })
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const body = await request.json().catch(() => ({}))
  try {
    const draft = draftFromPayload(body)
    const structural = structuralIssues(draft)
    if (structural.length && body.force !== true) {
      // Returned rather than written. An admin can override with `force`, which
      // stages a template that is known to be imperfect, but a template that
      // silently claimed to be fine would be worse than one refused.
      return NextResponse.json(
        { success: false, error: "This template has problems that would break a live deployment", structural },
        { status: 400, headers: NO_CACHE_HEADERS },
      )
    }
    const created = await createGuestTemplate({ ...body, force: true })
    await createPanelLog({
      category: "Guest Automation",
      message: `OS template created: ${created.row.name}`,
      actorType: "admin",
      actorEmail: String(admin.email),
      metadata: { templateId: created.row.id, slug: created.row.slug, engine: created.row.engine, operations: created.row.operations.length, enabled: created.row.enabled, warnings: created.result.warnings, structural },
    }).catch(() => null)
    return NextResponse.json({ success: true, template: created.row, structural: created.structural, warnings: created.result.warnings }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    if (error instanceof TemplateValidationError) {
      return NextResponse.json({ success: false, error: error.message, ...error.result }, { status: 400, headers: NO_CACHE_HEADERS })
    }
    return NextResponse.json({ success: false, error: sanitize(error) }, { status: 500, headers: NO_CACHE_HEADERS })
  }
}

function sanitize(error: unknown) {
  return String((error as any)?.message || error || "Unexpected error")
    .replace(/PVEAPIToken=[^\s"'<>]+/gi, "PVEAPIToken=[redacted]")
    .replace(/([?&](?:ticket|password|token|secret)=)[^&\s"']+/gi, "$1[redacted]")
    .slice(0, 400)
}
