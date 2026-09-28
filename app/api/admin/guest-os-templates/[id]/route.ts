import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { createPanelLog } from "@/lib/panel-log"
import { isGuestOperation } from "@/lib/guest-automation/constants"
import { prisma } from "@/lib/db"
import {
  deleteGuestTemplate,
  draftFromPayload,
  getGuestTemplate,
  setGuestTemplateEnabled,
  structuralIssues,
  TemplateValidationError,
  updateGuestTemplate,
} from "@/lib/guest-automation/admin-templates"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache", Expires: "0" }

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }
  const { id } = await context.params
  const template = await getGuestTemplate(id)
  if (!template) return NextResponse.json({ success: false, error: "Template not found" }, { status: 404, headers: NO_CACHE_HEADERS })
  return NextResponse.json({ success: true, template }, { headers: NO_CACHE_HEADERS })
}

/**
 * Edit a template, enable it, disable it, or delete it.
 *
 * The three acts are separate because they have different risk. Editing changes
 * what would happen to the next server; enabling changes what happens to servers
 * right now; deleting can orphan the recorded configuration of servers already
 * configured with it. Nothing here does all three implicitly.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const { id } = await context.params
  const body = await request.json().catch(() => ({}))

  try {
    if (body.action === "enable" || body.action === "disable") {
      const enabled = body.action === "enable"
      const row = await setGuestTemplateEnabled(id, enabled)
      if (!row) return NextResponse.json({ success: false, error: "Template not found" }, { status: 404, headers: NO_CACHE_HEADERS })
      await createPanelLog({
        category: "Guest Automation",
        message: `OS template ${enabled ? "enabled" : "disabled"}: ${row.name}`,
        actorType: "admin",
        actorEmail: String(admin.email),
        metadata: { templateId: id, slug: row.slug, engine: row.engine, version: row.version, enabled },
      }).catch(() => null)
      return NextResponse.json({ success: true, template: row }, { headers: NO_CACHE_HEADERS })
    }

    if (body.action === "delete") {
      await deleteGuestTemplate(id)
      await createPanelLog({
        category: "Guest Automation",
        message: `OS template deleted: ${body.name || id}`,
        actorType: "admin",
        actorEmail: String(admin.email),
        metadata: { templateId: id },
      }).catch(() => null)
      return NextResponse.json({ success: true }, { headers: NO_CACHE_HEADERS })
    }

    // A per-operation toggle, for turning one command off without deleting it.
    if (body.action === "set_operation_enabled") {
      const operation = String(body.operation || "")
      if (!isGuestOperation(operation)) {
        return NextResponse.json({ success: false, error: `"${operation}" is not a supported operation` }, { status: 400, headers: NO_CACHE_HEADERS })
      }
      const template = await getGuestTemplate(id)
      if (!template) return NextResponse.json({ success: false, error: "Template not found" }, { status: 404, headers: NO_CACHE_HEADERS })
      const target = template.operations.find((operation_: any) => operation_.operation === operation)
      if (!target) return NextResponse.json({ success: false, error: "This template does not define that operation" }, { status: 404, headers: NO_CACHE_HEADERS })
      const row = await setOperationEnabled(id, target.id, body.enabled === true)
      return NextResponse.json({ success: true, template: row }, { headers: NO_CACHE_HEADERS })
    }

    if (body.action === "add_operation" || body.action === "remove_operation") {
      const operation = String(body.operation || "")
      if (!isGuestOperation(operation)) {
        return NextResponse.json({ success: false, error: `"${operation}" is not a supported operation` }, { status: 400, headers: NO_CACHE_HEADERS })
      }
      const template = await getGuestTemplate(id)
      if (!template) return NextResponse.json({ success: false, error: "Template not found" }, { status: 404, headers: NO_CACHE_HEADERS })
      const exists = template.operations.some((entry: any) => entry.operation === operation)
      if (body.action === "add_operation" && exists) {
        return NextResponse.json({ success: false, error: "This template already defines that operation" }, { status: 409, headers: NO_CACHE_HEADERS })
      }
      if (body.action === "remove_operation" && !exists) {
        return NextResponse.json({ success: false, error: "This template does not define that operation" }, { status: 404, headers: NO_CACHE_HEADERS })
      }
      const draft = draftFromPayload({ ...template, operations: template.operations })
      draft.operations = body.action === "add_operation"
        ? [...draft.operations, defaultOperationDraft(operation, template.engine)]
        : draft.operations.filter((entry) => entry.operation !== operation)
      const updated = await updateGuestTemplate(id, { ...draft, enabled: template.enabled })
      if (!updated) return NextResponse.json({ success: false, error: "Template not found" }, { status: 404, headers: NO_CACHE_HEADERS })
      return NextResponse.json({ success: true, template: updated.row, versionBumped: updated.versionBumped }, { headers: NO_CACHE_HEADERS })
    }

    // A plain edit. Saving never enables, and never disables.
    const draft = draftFromPayload({ ...body, enabled: false })
    const structural = structuralIssues(draft)
    if (structural.length && body.force !== true) {
      return NextResponse.json(
        { success: false, error: "This template has problems that would break a live deployment", structural },
        { status: 400, headers: NO_CACHE_HEADERS },
      )
    }
    const updated = await updateGuestTemplate(id, { ...body, force: true })
    if (!updated) return NextResponse.json({ success: false, error: "Template not found" }, { status: 404, headers: NO_CACHE_HEADERS })
    await createPanelLog({
      category: "Guest Automation",
      message: `OS template updated: ${updated.row.name}`,
      actorType: "admin",
      actorEmail: String(admin.email),
      metadata: {
        templateId: id,
        slug: updated.row.slug,
        engine: updated.row.engine,
        version: updated.row.version,
        previousVersion: updated.previousVersion,
        versionBumped: updated.versionBumped,
        operations: updated.row.operations.length,
        structural,
      },
    }).catch(() => null)
    return NextResponse.json({
      success: true,
      template: updated.row,
      structural: updated.structural,
      versionBumped: updated.versionBumped,
      previousVersion: updated.previousVersion,
      // Said plainly, because it changes what a re-provisioned server gets.
      note: updated.versionBumped
        ? `Version ${updated.previousVersion} → ${updated.row.version}. Servers already running keep the configuration they were given; only new or re-provisioned servers use version ${updated.row.version}.`
        : `No behavioural change, so the version stays at ${updated.row.version}.`,
    }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    if (error instanceof TemplateValidationError) {
      return NextResponse.json({ success: false, error: error.message, ...error.result }, { status: 400, headers: NO_CACHE_HEADERS })
    }
    return NextResponse.json({ success: false, error: String(error?.message || error || "Unexpected error").slice(0, 400) }, { status: 500, headers: NO_CACHE_HEADERS })
  }
}

async function setOperationEnabled(templateId: string, operationId: string, enabled: boolean) {
  await prisma.guestOperationTemplate.update({ where: { id: operationId }, data: { enabled } })
  return getGuestTemplate(templateId)
}

/**
 * A starting point for a newly added operation.
 *
 * Deliberately incomplete: `command` is empty and `enabled` is false, so a new
 * operation cannot be turned on until someone has written and tested a command
 * for it. The alternative — a plausible-looking default — would be a command
 * nobody wrote, running on a customer's server.
 */
function defaultOperationDraft(operation: string, engine: string) {
  return {
    operation,
    enabled: false,
    commandType: operation === "detect_os" || operation === "detect_network" || operation === "guest_health" ? "guest-native" : "guest-exec",
    shell: engine === "windows" ? "windows-powershell" : "linux-sh",
    command: null,
    timeoutSeconds: 60,
    requiresRunning: true,
    requiresStopped: false,
    requiresGuestAgent: true,
    rebootRequired: false,
    dangerLevel: "safe",
    requiresConfirmation: false,
    supportsRollback: false,
    verificationRequired: true,
    verificationCommand: null,
    verificationParser: null,
    successCondition: null,
    rollbackCommand: null,
    fallbacks: null,
    stateKey: null,
    notes: "Added but not configured. Write and test a command before enabling.",
  }
}
