import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { createPanelLog } from "@/lib/panel-log"
import { prisma } from "@/lib/db"
import { GuestAutomationService, osMetadataForVps } from "@/lib/guest-automation/service"
import { guestContextFor } from "@/lib/guest-automation/first-boot"
import { getGuestTemplate, recordTemplateTest, structuralIssues, draftFromPayload } from "@/lib/guest-automation/admin-templates"
import { maskCommandSecrets } from "@/lib/guest-automation/placeholders"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache", Expires: "0" }

/**
 * Prove a whole template against a running guest.
 *
 * Nothing here trusts a flag or a version number. It asks the guest what OS it
 * is, asks whether the draft's commands belong to that OS, and — unless the
 * admin explicitly asked for a dry run — actually runs the operations that are
 * safe to run, and records the result against the template.
 *
 * A test never runs a destructive operation without an explicit confirmation in
 * the request body. "Test this template" must not be able to wipe a filesystem.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const { id } = await context.params
  const body = await request.json().catch(() => ({}))
  const dryRun = body.dryRun === true
  const confirmDestructive = body.confirmDestructive === true

  const stored = await getGuestTemplate(id)
  if (!stored) {
    return NextResponse.json({ success: false, error: "Template not found" }, { status: 404, headers: NO_CACHE_HEADERS })
  }

  // The template under test is either the stored one or an unsaved draft, so an
  // admin can prove an edit before committing it.
  const draft = body.draft ? draftFromPayload({ ...stored, ...body.draft }) : draftFromPayload(stored)
  const structural = structuralIssues(draft)

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
      await recordTemplateTest(id, { status: "failed", error: "OS_DETECTION_UNAVAILABLE", at: new Date().toISOString() })
      return NextResponse.json({
        success: false,
        error: "The guest did not report its operating system, so there is no way to know which command set belongs to it. Nothing was run.",
        errorCode: "OS_DETECTION_UNAVAILABLE",
        structural,
      }, { status: 409, headers: NO_CACHE_HEADERS })
    }

    // A template whose engine disagrees with the guest that answered would be
    // selected for a different OS entirely, so it is refused before anything runs.
    if (draft.engine !== detected.engine) {
      const message = `This template is for the ${draft.engine} engine but the guest reports ${detected.osId}, which is ${detected.engine}. Running it would execute ${draft.engine === "windows" ? "PowerShell" : "shell"} commands on a ${detected.engine} guest.`
      await recordTemplateTest(id, { status: "failed", error: "ENGINE_MISMATCH", os: detected.osId, at: new Date().toISOString() })
      return NextResponse.json({ success: false, error: message, errorCode: "ENGINE_MISMATCH", detected, structural }, { status: 409, headers: NO_CACHE_HEADERS })
    }

    const operations = draft.operations.filter((operation) => operation.enabled !== false)
    const results: Record<string, any> = {}
    let ran = 0
    let failed = 0

    for (const operation of operations) {
      const destructive = operation.dangerLevel === "dangerous" || operation.requiresStopped
      if (dryRun) {
        const preview = await service.previewOperation({
          operation: operation.operation as any,
          draft: {
            commandType: operation.commandType || "guest-exec",
            shell: operation.shell,
            command: operation.command,
            verificationCommand: operation.verificationCommand,
            verificationParser: operation.verificationParser,
            successCondition: operation.successCondition,
            dangerLevel: operation.dangerLevel,
            requiresConfirmation: operation.requiresConfirmation,
            requiresRunning: operation.requiresRunning,
            requiresStopped: operation.requiresStopped,
            requiresGuestAgent: operation.requiresGuestAgent,
            verificationRequired: operation.verificationRequired,
            timeoutSeconds: operation.timeoutSeconds,
          },
          metadata: target.metadata ?? null,
        })
        results[operation.operation] = preview.ok
          ? { status: "dry_run", commandMasked: preview.commandMasked, verificationMasked: preview.verificationMasked, placeholders: preview.placeholders, unknownPlaceholders: preview.unknownPlaceholders }
          : { status: "failed", error: preview.message, errorCode: preview.errorCode }
        if (!preview.ok) failed += 1
        continue
      }

      if (destructive && !confirmDestructive) {
        // Refused, and said so. A "test this template" click must not be able to
        // reach a filesystem resize or anything else marked dangerous.
        results[operation.operation] = {
          status: "skipped",
          reason: "This operation is marked dangerous or needs a stopped server. Confirm explicitly to run it.",
          requiresConfirmation: true,
        }
        continue
      }

      const tested = await service.testOperation({
        operation: operation.operation as any,
        metadata: target.metadata ?? null,
        actor: { requestedBy: String(admin.email), role: "admin" },
        draft: {
          commandType: operation.commandType || "guest-exec",
          shell: operation.shell,
          command: operation.command,
          verificationCommand: operation.verificationCommand,
          verificationParser: operation.verificationParser,
          successCondition: operation.successCondition,
          dangerLevel: operation.dangerLevel,
          requiresRunning: operation.requiresRunning,
          requiresStopped: operation.requiresStopped,
          requiresGuestAgent: operation.requiresGuestAgent,
          verificationRequired: operation.verificationRequired,
          supportsRollback: operation.supportsRollback,
          timeoutSeconds: operation.timeoutSeconds,
        },
      })
      ran += 1
      if (!tested.ok) {
        failed += 1
        results[operation.operation] = { status: "failed", error: tested.message, errorCode: tested.errorCode }
        continue
      }
      results[operation.operation] = {
        status: tested.outcome.status,
        changed: tested.outcome.changed,
        verified: tested.outcome.verified,
        durationMs: tested.outcome.durationMs,
        error: tested.outcome.error,
        errorCode: tested.outcome.errorCode,
        commandMasked: tested.outcome.commandMasked ? maskCommandSecrets(String(tested.outcome.commandMasked), [body.samplePassword]) : null,
        runId: tested.runId,
      }
    }

    const status = failed > 0 ? "failed" : "success"
    const summary = {
      status,
      dryRun,
      at: new Date().toISOString(),
      engine: detected.engine,
      os: detected.osId,
      osName: detected.name,
      templateSlug: draft.slug,
      templateVersion: stored.version,
      structural,
      operations: results,
      ran,
      failed,
      skipped: Object.values(results).filter((entry: any) => entry.status === "skipped").length,
    }
    // A dry run is a reading, not a result: it must not overwrite the record of
    // what a real run proved.
    if (!dryRun) await recordTemplateTest(id, summary as any)

    await createPanelLog({
      category: "Guest Automation",
      message: `OS template ${dryRun ? "dry run" : "test"}: ${draft.name} on ${detected.osId}`,
      actorType: "admin",
      actorEmail: String(admin.email),
      metadata: {
        templateId: id,
        slug: draft.slug,
        dryRun,
        os: detected.osId,
        engine: detected.engine,
        status,
        ran,
        failed,
        // Operation names and outcomes only. No command text, no arguments, no
        // substituted values.
        operations: Object.fromEntries(Object.entries(results).map(([key, value]: any) => [key, { status: value.status, errorCode: value.errorCode || null }])),
      },
    }).catch(() => null)

    return NextResponse.json({ success: status === "success", ...summary }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: safeMessage(error), structural }, { status: 500, headers: NO_CACHE_HEADERS })
  }
}

/**
 * Resolve the VM to test against.
 *
 * A vpsInstanceId is the normal route, because that is the only one where the
 * panel already knows the node credentials and the template metadata. A node and
 * vmid are accepted for a VM that is not yet a panel service, which is how a
 * template is proved before it is used to provision anything.
 */
async function resolveTarget(body: any) {
  if (body.vpsInstanceId) {
    const vps = await prisma.vpsInstance.findUnique({
      where: { id: String(body.vpsInstanceId) },
      include: { proxmoxNode: true, operatingSystem: true },
    })
    if (!vps?.proxmoxNode || !vps.vmid) return null
    return {
      vpsInstanceId: vps.id,
      vmid: Number(vps.vmid),
      node: vps.proxmoxNode,
      metadata: osMetadataForVps(vps) as Record<string, unknown>,
    }
  }
  if (body.nodeName && body.vmid) {
    const node = await prisma.proxmoxNode.findFirst({ where: { nodeName: String(body.nodeName) } })
    if (!node) return null
    return {
      vpsInstanceId: `external:${node.id}:${body.vmid}`,
      vmid: Number(body.vmid),
      node,
      metadata: null,
    }
  }
  return null
}

function safeMessage(error: unknown) {
  return String((error as any)?.message || error || "Unexpected error")
    .replace(/PVEAPIToken=[^\s"'<>]+/gi, "PVEAPIToken=[redacted]")
    .replace(/([?&](?:ticket|password|token|secret)=)[^&\s"']+/gi, "$1[redacted]")
    .slice(0, 400)
}
