import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { prisma } from "@/lib/db"
import { adoptionSummary, adoptVpsIntoGuestAutomation, listAdoptions } from "@/lib/guest-automation/adoption"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache", Expires: "0" }

/** Which servers are managed, which are not, and why. */
export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }
  const [summary, adoptions] = await Promise.all([adoptionSummary(), listAdoptions()])
  return NextResponse.json({
    success: true,
    summary,
    adoptions: adoptions.map((row) => ({
      vpsInstanceId: row.vpsInstanceId,
      engine: row.engine,
      os: row.detectedOsId,
      osName: row.detectedName,
      osVersion: row.detectedVersion,
      automationReady: row.automationReady,
      guestAgentReachable: row.guestAgentReachable,
      guestAgentCheckedAt: row.guestAgentCheckedAt,
      unsupportedReason: row.unsupportedReason,
      recoveryRequired: row.recoveryRequired,
      recoveryReason: row.recoveryReason,
      template: row.guestTemplate ? { id: row.guestTemplate.id, name: row.guestTemplate.name, version: row.guestTemplate.version, engine: row.guestTemplate.engine } : null,
      appliedTemplateVersion: row.appliedTemplateVersion,
      lastDetectedAt: row.lastDetectedAt,
      adoptedAt: row.adoptedAt,
    })),
  }, { headers: NO_CACHE_HEADERS })
}

/**
 * Adopt one server, or many.
 *
 * Detection and recording only. Nothing is reconfigured: rewriting a running
 * customer's network as a side effect of "let us manage this server" is how a
 * control panel takes production offline. The first real change is a separate,
 * explicit request, and it goes through the same change-driven plan as every
 * other change.
 */
export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const body = await request.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body.vpsInstanceIds)
    ? body.vpsInstanceIds.map((value: unknown) => String(value)).filter(Boolean)
    : body.vpsInstanceId
      ? [String(body.vpsInstanceId)]
      : []
  if (!ids.length) {
    return NextResponse.json({ success: false, error: "Choose at least one server to adopt." }, { status: 400, headers: NO_CACHE_HEADERS })
  }
  // A bounded batch, so one request cannot open an unbounded number of guest
  // sessions. 20 is well inside what the guest agent tolerates concurrently.
  if (ids.length > 20) {
    return NextResponse.json({ success: false, error: "Adopt at most 20 servers at a time." }, { status: 400, headers: NO_CACHE_HEADERS })
  }

  const servers = await prisma.vpsInstance.findMany({
    where: { id: { in: ids } },
    select: { id: true, vmid: true, status: true, operatingSystemId: true, name: true, proxmoxNode: true },
  })
  if (!servers.length) {
    return NextResponse.json({ success: false, error: "None of those servers were found." }, { status: 404, headers: NO_CACHE_HEADERS })
  }

  const results = []
  for (const vps of servers) {
    // Sequential on purpose. Each adoption opens guest sessions against a
    // hypervisor, and a burst of a hundred would be indistinguishable from an
    // attack to the thing being managed.
    const outcome = await adoptVpsIntoGuestAutomation({ vps: vps as any, actorEmail: String(admin.email) })
    results.push({ name: vps.name, id: vps.id, ...outcome })
  }

  const adopted = results.filter((row) => row.ok).length
  return NextResponse.json({
    success: true,
    adopted,
    total: results.length,
    results,
    note: "Adoption records what each server is and which profile will configure it. Nothing was reconfigured.",
  }, { headers: NO_CACHE_HEADERS })
}
