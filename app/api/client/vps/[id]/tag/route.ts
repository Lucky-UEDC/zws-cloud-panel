import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { normalizeServerTag, isRejectedServerTag } from "@/lib/vm-hostname"
import { createAuditEvent } from "@/lib/audit-events"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

/**
 * Client-managed Server Tag (displayTag) update (spec Part 8).
 *
 * Only the friendly display tag is editable by the customer — the system
 * hostname, Proxmox identity and network state are NEVER touched here.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now()
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customer?.sub) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const rawTag = String(body?.serverTag ?? "")

  const serverTag = normalizeServerTag(rawTag)
  if (isRejectedServerTag(rawTag)) {
    return NextResponse.json(
      { success: false, error: "Server Tag may only contain letters, numbers, spaces, hyphens and underscores (up to 64 characters)." },
      { status: 400, headers: NO_CACHE_HEADERS },
    )
  }

  const instance = await prisma.vpsInstance.findFirst({ where: { id, customerId, deletedAt: null }, select: { id: true, displayTag: true, vmid: true } })
  if (!instance) return NextResponse.json({ success: false, error: "Server not found" }, { status: 404, headers: NO_CACHE_HEADERS })

  const previous = instance.displayTag || null
  await prisma.vpsInstance.update({ where: { id: instance.id }, data: { displayTag: serverTag || null } })

  await createAuditEvent({
    eventType: "server_tag_changed",
    severity: "INFO",
    actorType: "USER",
    actorId: String(customer.sub || ""),
    customerId,
    targetType: "vps_instance",
    targetId: instance.id,
    vmid: instance.vmid != null ? Number(instance.vmid) : null,
    vpsInstanceId: instance.id,
    oldValue: previous ? { displayTag: previous } : null,
    newValue: serverTag ? { displayTag: serverTag } : { displayTag: null },
    reason: "Customer updated Server Tag",
    status: "completed",
    durationMs: Date.now() - startedAt,
  }).catch(() => null)

  return NextResponse.json({ success: true, serverTag, displayTag: serverTag || null }, { headers: NO_CACHE_HEADERS })
}