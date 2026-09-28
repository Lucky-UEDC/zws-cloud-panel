import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { createPanelLog } from "@/lib/panel-log"
import { prisma } from "@/lib/db"
import { isGuestOperation } from "@/lib/guest-automation/constants"
import { GuestAutomationService, osMetadataForVps } from "@/lib/guest-automation/service"
import { guestContextFor } from "@/lib/guest-automation/first-boot"
import { getGuestTemplate } from "@/lib/guest-automation/admin-templates"
import { extractPlaceholders, unknownPlaceholders, GUEST_PLACEHOLDERS } from "@/lib/guest-automation/placeholders"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache", Expires: "0" }

/**
 * Test or dry-run one operation.
 *
 * This is the endpoint behind the editor's "Test" button. It takes the operation
 * name and either the stored definition or an unsaved draft, and returns either a
 * rendered-and-masked preview or a real verified run.
 *
 * The dangerous cases are handled explicitly rather than by hiding the button:
 * an operation marked dangerous or one that needs a stopped server is refused
 * unless the request says `confirmDangerous`, and a refusal says why.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string; operation: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const { id, operation } = await context.params
  if (!isGuestOperation(operation)) {
    return NextResponse.json({ success: false, error: `"${operation}" is not a supported operation` }, { status: 400, headers: NO_CACHE_HEADERS })
  }

  const body = await request.json().catch(() => ({}))
  const dryRun = body.dryRun !== false
  const confirmDangerous = body.confirmDangerous === true

  const stored = await getGuestTemplate(id)
  if (!stored) {
    return NextResponse.json({ success: false, error: "Template not found" }, { status: 404, headers: NO_CACHE_HEADERS })
  }
  const storedOperation = stored.operations.find((entry: any) => entry.operation === operation)
  if (!storedOperation && !body.draft) {
    return NextResponse.json({
      success: false,
      error: `This template does not define ${operation}. Add the operation before testing it.`,
    }, { status: 404, headers: NO_CACHE_HEADERS })
  }

  const definition = {
    commandType: String(body.draft?.commandType ?? storedOperation?.commandType ?? "guest-exec"),
    shell: body.draft?.shell ?? storedOperation?.shell ?? null,
    command: body.draft?.command ?? storedOperation?.command ?? null,
    verificationCommand: body.draft?.verificationCommand ?? storedOperation?.verificationCommand ?? null,
    verificationParser: body.draft?.verificationParser ?? storedOperation?.verificationParser ?? null,
    successCondition: body.draft?.successCondition ?? storedOperation?.successCondition ?? null,
    dangerLevel: body.draft?.dangerLevel ?? storedOperation?.dangerLevel ?? "safe",
    requiresConfirmation: body.draft?.requiresConfirmation ?? storedOperation?.requiresConfirmation ?? false,
    requiresRunning: body.draft?.requiresRunning ?? storedOperation?.requiresRunning ?? false,
    requiresStopped: body.draft?.requiresStopped ?? storedOperation?.requiresStopped ?? false,
    requiresGuestAgent: body.draft?.requiresGuestAgent ?? storedOperation?.requiresGuestAgent ?? true,
    verificationRequired: body.draft?.verificationRequired ?? storedOperation?.verificationRequired ?? true,
    supportsRollback: body.draft?.supportsRollback ?? storedOperation?.supportsRollback ?? false,
    timeoutSeconds: body.draft?.timeoutSeconds ?? storedOperation?.timeoutSeconds ?? 60,
  }

  const usedPlaceholders = extractPlaceholders(String(definition.command || "").concat(" ", String(definition.verificationCommand || "")))
  const missingValues = [...new Set([...usedPlaceholders, ...requiredValuesFor(operation)])]
    .filter((placeholder) => GUEST_PLACEHOLDERS.includes(placeholder as any))
    .filter((placeholder) => body.values?.[placeholder] === undefined)
  if (!dryRun && missingValues.length) {
    // Rather than substituting an empty string into a live command — which
    // produces a malformed network configuration — the request is refused and
    // the values that are needed are named.
    return NextResponse.json({
      success: false,
      error: `This command needs values for ${missingValues.join(", ")}. Supply them, or use a dry run to see how it renders.`,
      missingValues,
    }, { status: 400, headers: NO_CACHE_HEADERS })
  }

  const destructive = definition.dangerLevel === "dangerous" || definition.requiresStopped
  if (!dryRun && destructive && !confirmDangerous) {
    return NextResponse.json({
      success: false,
      error: definition.requiresStopped
        ? "This operation needs the server stopped, so it was not run. Stop the test server, then confirm."
        : "This operation is marked dangerous, so it was not run. Confirm explicitly to run it.",
      requiresConfirmation: true,
      requiresStopped: definition.requiresStopped,
      dangerLevel: definition.dangerLevel,
    }, { status: 409, headers: NO_CACHE_HEADERS })
  }

  try {
    const target = await resolveTarget(body)
    if (!target) {
      return NextResponse.json(
        { success: false, error: "Choose a running server to test against: a vpsInstanceId, or a node and vmid." },
        { status: 400, headers: NO_CACHE_HEADERS },
      )
    }

    const service = new GuestAutomationService(guestContextFor(target))
    const detected = await service.detectOs(target.metadata ?? null)
    if (detected.kind === "unknown") {
      return NextResponse.json({
        success: false,
        errorCode: "OS_DETECTION_UNAVAILABLE",
        error: "The guest did not report its operating system, so there is no way to tell which command set belongs to it. Nothing was run.",
      }, { status: 409, headers: NO_CACHE_HEADERS })
    }

    if (dryRun) {
      const preview = await service.previewOperation({
        operation: operation as any,
        draft: definition,
        metadata: target.metadata ?? null,
        values: body.values || {},
      })
      if (!preview.ok) {
        return NextResponse.json({
          success: false,
          error: preview.message,
          errorCode: preview.errorCode,
          detected,
        }, { status: 400, headers: NO_CACHE_HEADERS })
      }
      return NextResponse.json({
        success: true,
        dryRun: true,
        operation,
        ...preview,
        missingValues,
        unknownPlaceholders: unknownPlaceholders(String(definition.command || "")),
      }, { headers: NO_CACHE_HEADERS })
    }

    const tested = await service.testOperation({
      operation: operation as any,
      metadata: target.metadata ?? null,
      actor: { requestedBy: String(admin.email), role: "admin" },
      draft: definition,
      values: body.values || {},
    })
    if (!tested.ok) {
      return NextResponse.json({ success: false, errorCode: tested.errorCode, error: tested.message, detected }, { status: 409, headers: NO_CACHE_HEADERS })
    }

    await createPanelLog({
      category: "Guest Automation",
      message: `Operation tested: ${stored.name} / ${operation}`,
      actorType: "admin",
      actorEmail: String(admin.email),
      metadata: {
        templateId: id,
        operation,
        os: detected.osId,
        engine: detected.engine,
        runId: tested.runId,
        status: tested.outcome.status,
        changed: tested.outcome.changed,
        verified: tested.outcome.verified,
        durationMs: tested.outcome.durationMs,
        errorCode: tested.outcome.errorCode,
        // The command is deliberately absent. A log that contains the command
        // text of a password or network operation is a log that leaks.
      },
    }).catch(() => null)

    return NextResponse.json({
      success: tested.outcome.status === "success" || tested.outcome.status === "skipped",
      dryRun: false,
      operation,
      detected,
      runId: tested.runId,
      outcome: tested.outcome,
    }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: safeMessage(error) }, { status: 500, headers: NO_CACHE_HEADERS })
  }
}

/** Values an operation cannot meaningfully run without, whatever its command says. */
function requiredValuesFor(operation: string): string[] {
  switch (operation) {
    case "set_ip": return ["IP", "PREFIX", "GATEWAY"]
    case "set_gateway": return ["GATEWAY"]
    case "set_dns": return ["DNS1"]
    case "set_hostname": return ["HOSTNAME"]
    case "set_password":
    case "create_user":
    case "update_user": return ["USERNAME"]
    default: return []
  }
}

async function resolveTarget(body: any) {
  if (body.vpsInstanceId) {
    const vps = await prisma.vpsInstance.findUnique({ where: { id: String(body.vpsInstanceId) }, include: { proxmoxNode: true, operatingSystem: true } })
    if (!vps?.proxmoxNode || !vps.vmid) return null
    return { vpsInstanceId: vps.id, vmid: Number(vps.vmid), node: vps.proxmoxNode, metadata: osMetadataForVps(vps) as Record<string, unknown> }
  }
  if (body.nodeName && body.vmid) {
    const node = await prisma.proxmoxNode.findFirst({ where: { nodeName: String(body.nodeName) } })
    if (!node) return null
    return { vpsInstanceId: `external:${node.id}:${body.vmid}`, vmid: Number(body.vmid), node, metadata: null }
  }
  return null
}

function safeMessage(error: unknown) {
  return String((error as any)?.message || error || "Unexpected error")
    .replace(/PVEAPIToken=[^\s"'<>]+/gi, "PVEAPIToken=[redacted]")
    .replace(/([?&](?:ticket|password|token|secret)=)[^&\s"']+/gi, "$1[redacted]")
    .slice(0, 400)
}
