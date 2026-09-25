import { NextRequest, NextResponse } from "next/server"
import { extractClientIp } from "@/lib/request-context"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { createAuditLog } from "@/lib/audit-log"
import { createPanelLog } from "@/lib/panel-log"

function dateOrNull(value: unknown) {
  if (value === null || value === "" || value === undefined) return null
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date value")
  return date
}

function asObj(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {}
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function nonNegativeInt(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === "") return Math.max(0, fallback)
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new Error("Delay days must be zero or greater")
  return Math.floor(number)
}

function simplifiedLifecycle(input: { renewalDueAt: Date | null; suspensionDelayDays: number; deletionDelayDays: number; penaltyWindowDays?: number | null }) {
  const suspendAt = input.renewalDueAt ? addDays(input.renewalDueAt, input.suspensionDelayDays) : null
  const deletionAt = suspendAt ? addDays(suspendAt, input.deletionDelayDays) : null
  const penaltyAt = suspendAt ? addDays(suspendAt, Math.max(0, Number(input.penaltyWindowDays ?? 1) || 0)) : null
  return { suspendAt, penaltyAt, terminationAt: deletionAt, deletionAt }
}

async function adminProfileId(email: string) {
  const row = await prisma.adminProfile.findUnique({ where: { email: email.toLowerCase() }, select: { id: true } }).catch(() => null)
  return row?.id || null
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : []
    if (!ids.length) return NextResponse.json({ success: false, error: "Select at least one VM" }, { status: 400 })

    const reason = String(body.reason || "").trim()
    const editorId = await adminProfileId(String(admin.email))
    const rows = await prisma.vpsInstance.findMany({ where: { id: { in: ids }, deletedAt: null } })
    let updated = 0
    const skipped: Array<{ id: string; reason: string }> = []

    for (const vps of rows) {
      const renewalDueAt = body.renewalDueAt === undefined ? vps.renewalDueAt || vps.nextRenewalAt : dateOrNull(body.renewalDueAt)
      const suspensionDelayDays = nonNegativeInt(body.suspensionDelayDays ?? body.graceDays, vps.graceDays)
      const deletionDelayDays = nonNegativeInt(body.deletionDelayDays, Math.max(1, vps.retentionDays || 7))
      const lifecycle = simplifiedLifecycle({ renewalDueAt, suspensionDelayDays, deletionDelayDays, penaltyWindowDays: (vps as any).penaltyWindowDays })
      const createdAt = body.createdAt === undefined ? vps.createdAt : dateOrNull(body.createdAt)
      const activatedAt = body.activatedAt === undefined ? vps.activatedAt : dateOrNull(body.activatedAt)
      const suspendAt = lifecycle.suspendAt
      const penaltyAt = lifecycle.penaltyAt
      const terminationAt = lifecycle.terminationAt
      const deletionAt = lifecycle.deletionAt

      const oldValue = {
        createdAt: vps.createdAt,
        activatedAt: vps.activatedAt,
        renewalDueAt: vps.renewalDueAt,
        suspendAt: vps.suspendAt,
        terminationAt: vps.terminationAt,
        deletionAt: vps.deletionAt,
      }
      const next = await prisma.vpsInstance.update({
        where: { id: vps.id },
        data: {
          ...(createdAt ? { createdAt } : {}),
          activatedAt,
          renewalDueAt,
          nextRenewalAt: renewalDueAt,
          graceDays: suspensionDelayDays,
          suspendAt,
          penaltyAt,
          terminationAt,
          deletionAt,
          manualExpiryOverride: true,
          manualCreatedDateOverride: Boolean(createdAt && createdAt.getTime() !== vps.createdAt.getTime()),
          createdAtManual: createdAt || null,
          activatedAtManual: activatedAt || null,
          renewalAtManual: renewalDueAt || null,
          suspendAtManual: suspendAt || null,
          terminationAtManual: terminationAt || null,
          deletionAtManual: deletionAt || null,
          editedByAdminId: editorId,
          editedAt: new Date(),
          editReason: reason || null,
          lifecycleMetadata: { ...asObj(vps.lifecycleMetadata), bulkLifecycleOverrideAt: new Date().toISOString(), bulkLifecycleReason: reason || null, suspensionDelayDays, deletionDelayDays },
        },
      })
      updated += 1
      await createAuditLog({
        action: "VPS_BILLING_BULK_EDIT_DATES",
        adminId: editorId,
        actorEmail: String(admin.email),
        customerId: vps.customerId,
        targetType: "vps_instance",
        targetId: vps.id,
        oldValue,
        newValue: {
          createdAt: next.createdAt,
          activatedAt: next.activatedAt,
          renewalDueAt: next.renewalDueAt,
          suspendAt: next.suspendAt,
          terminationAt: next.terminationAt,
          deletionAt: next.deletionAt,
        },
        metadata: { vmid: vps.vmid, reason: reason || null },
        ipAddress: extractClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }).catch(() => null)
    }

    for (const id of ids) {
      if (!rows.some((row) => row.id === id)) skipped.push({ id, reason: "not_found" })
    }

    await createPanelLog({
      category: "BILLING",
      message: "vps_billing_lifecycle_bulk_updated",
      actorType: "admin",
      actorId: editorId,
      actorEmail: String(admin.email),
      metadata: { selected: ids.length, updated, skipped, reason: reason || null },
    }).catch(() => null)

    return NextResponse.json({ success: true, updated, skipped })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Bulk lifecycle update failed" }, { status: 400 })
  }
}
