import { NextRequest, NextResponse } from "next/server"
import { extractClientIp } from "@/lib/request-context"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { createAuditLog } from "@/lib/audit-log"
import { createPanelLog } from "@/lib/panel-log"
import { runAdminVmAction } from "@/lib/admin-vm-management"
import { lifecycleDates } from "@/lib/renewals"
import { buildSupportCode, safeApiErrorMessage } from "@/lib/api-error-safe"
import { invoiceTaxWriteFields, money } from "@/lib/invoices/tax"

function dateOrNull(value: unknown) {
  if (value === null || value === "" || value === undefined) return null
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date value")
  return date
}

function asObj(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {}
}

async function getVm(id: string) {
  const vps = await prisma.vpsInstance.findUnique({ where: { id }, include: { customer: true, order: true, proxmoxNode: true } })
  if (!vps) throw new Error("VM not found")
  return vps
}

async function audit(request: NextRequest, admin: any, vps: any, action: string, oldValue: unknown, newValue: unknown) {
  await createAuditLog({
    action,
    adminId: admin.sub || null,
    actorEmail: admin.email || null,
    customerId: vps.customerId,
    targetType: "vps_instance",
    targetId: vps.id,
    oldValue,
    newValue,
    ipAddress: extractClientIp(request) || null,
    userAgent: request.headers.get("user-agent"),
    metadata: { vmid: vps.vmid },
  }).catch(() => null)
}

async function adminProfileId(admin: any) {
  if (admin?.sub) return String(admin.sub)
  const row = await prisma.adminProfile.findUnique({
    where: { email: String(admin?.email || "").toLowerCase() },
    select: { id: true },
  }).catch(() => null)
  return row?.id || null
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

function simplifiedLifecycle(input: {
  renewalDueAt: Date | null
  suspensionDelayDays: number
  deletionDelayDays: number
  penaltyWindowDays?: number | null
}) {
  const suspendAt = input.renewalDueAt ? addDays(input.renewalDueAt, input.suspensionDelayDays) : null
  const deletionAt = suspendAt ? addDays(suspendAt, input.deletionDelayDays) : null
  const penaltyAt = suspendAt ? addDays(suspendAt, Math.max(0, Number(input.penaltyWindowDays ?? 1) || 0)) : null
  return { suspendAt, penaltyAt, terminationAt: deletionAt, deletionAt }
}

async function waivePenalty(vps: any) {
  const invoice = await prisma.invoice.findFirst({
    where: {
      customerId: vps.customerId,
      deletedAt: null,
      status: { in: ["draft", "sent", "pending", "overdue"] },
      metadata: { path: ["vpsInstanceId"], equals: vps.id },
    },
    orderBy: { createdAt: "desc" },
  })
  if (!invoice) return { invoice: null, waived: 0 }
  const items = Array.isArray(invoice.lineItems) ? invoice.lineItems : []
  const waived = items.filter((item: any) => item?.type === "late_fee").reduce((sum: number, item: any) => sum + Number(item.total || 0), 0)
  const nextItems = items.filter((item: any) => item?.type !== "late_fee")
  if (waived > 0) {
    const nextSubtotal = Math.max(0, money(Number(invoice.subtotal || 0) - waived))
    const nextTaxRate = money((invoice as any).gstPercent ?? invoice.taxRate)
    const nextTaxAmount = money(nextSubtotal * (nextTaxRate / 100))
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        lineItems: nextItems,
        subtotal: nextSubtotal,
        ...invoiceTaxWriteFields({ taxRate: nextTaxRate, taxAmount: nextTaxAmount }),
        totalAmount: money(nextSubtotal + nextTaxAmount),
        metadata: { ...asObj(invoice.metadata), penaltyWaivedAt: new Date().toISOString(), penaltyWaivedAmount: waived },
      },
    })
  }
  await prisma.vpsInstance.update({ where: { id: vps.id }, data: { penaltyAppliedAt: null, status: "OVERDUE" } })
  return { invoice: invoice.id, waived }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const action = String(body.action || "").trim()
    const vps = await getVm(id)
    const oldValue = {
      status: vps.status,
      createdAt: vps.createdAt,
      activatedAt: vps.activatedAt,
      renewalDueAt: vps.renewalDueAt,
      nextRenewalAt: vps.nextRenewalAt,
      suspendAt: vps.suspendAt,
      penaltyAt: vps.penaltyAt,
      terminationAt: vps.terminationAt,
      deletionAt: vps.deletionAt,
      penaltyAppliedAt: vps.penaltyAppliedAt,
      autoSuspendEnabled: vps.autoSuspendEnabled,
      autoDeleteEnabled: vps.autoDeleteEnabled,
      automationPausedAt: vps.automationPausedAt,
      remindersPausedAt: vps.remindersPausedAt,
    }

    let result: any
    const editorId = await adminProfileId(admin)
    if (action === "edit_dates" || action === "extend_expiry" || action === "reduce_expiry" || action === "extend_7d" || action === "extend_30d") {
      const requestedRenewal = dateOrNull(body.renewalDueAt ?? body.nextRenewalAt)
      const extendDays = action === "extend_7d" ? 7 : action === "extend_30d" ? 30 : Number(body.extendDays || 0)
      const renewalDueAt = extendDays
        ? addDays(requestedRenewal || vps.renewalDueAt || vps.nextRenewalAt || new Date(), extendDays)
        : requestedRenewal
      const suspensionDelayDays = nonNegativeInt(body.suspensionDelayDays ?? body.graceDays, vps.graceDays)
      const deletionDelayDays = nonNegativeInt(body.deletionDelayDays, Math.max(1, vps.retentionDays || 7))
      const lifecycle = simplifiedLifecycle({
        renewalDueAt,
        suspensionDelayDays,
        deletionDelayDays,
        penaltyWindowDays: (vps as any).penaltyWindowDays,
      })
      const createdAt = body.createdAt === undefined ? vps.createdAt : dateOrNull(body.createdAt)
      const activatedAt = body.activatedAt === undefined ? vps.activatedAt : dateOrNull(body.activatedAt)
      const suspendAt = lifecycle.suspendAt
      const penaltyAt = lifecycle.penaltyAt
      const terminationAt = lifecycle.terminationAt
      const deletionAt = lifecycle.deletionAt
      result = await prisma.vpsInstance.update({
        where: { id },
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
          editReason: body.reason ? String(body.reason) : null,
          lifecycleMetadata: { ...asObj(vps.lifecycleMetadata), manualBillingOverrideAt: new Date().toISOString(), manualBillingReason: body.reason || null, extendDays: extendDays || null, suspensionDelayDays, deletionDelayDays },
        },
      })
    } else if (action === "reset_auto") {
      const renewalDueAt = vps.renewalDueAt || vps.nextRenewalAt
      const lifecycle = lifecycleDates({
        renewalDueAt,
        graceDays: vps.graceDays,
        penaltyWindowDays: (vps as any).penaltyWindowDays,
        terminationWindowDays: (vps as any).terminationWindowDays,
        retentionDays: vps.retentionDays,
      })
      result = await prisma.vpsInstance.update({
        where: { id },
        data: {
          renewalDueAt,
          nextRenewalAt: renewalDueAt,
          suspendAt: lifecycle.suspendAt,
          penaltyAt: lifecycle.penaltyAt,
          terminationAt: lifecycle.terminationAt,
          deletionAt: lifecycle.deletionAt,
          manualExpiryOverride: false,
          manualCreatedDateOverride: false,
          createdAtManual: null,
          activatedAtManual: null,
          renewalAtManual: null,
          suspendAtManual: null,
          terminationAtManual: null,
          deletionAtManual: null,
          editedByAdminId: editorId,
          editedAt: new Date(),
          editReason: body.reason ? String(body.reason) : "Reset lifecycle automation",
          lifecycleMetadata: { ...asObj(vps.lifecycleMetadata), manualBillingResetAt: new Date().toISOString(), manualBillingResetBy: admin.email || null },
        },
      })
    } else if (action === "waive_penalty") {
      result = await waivePenalty(vps)
    } else if (action === "postpone_deletion") {
      const deletionAt = dateOrNull(body.deletionAt)
      if (!deletionAt) throw new Error("Deletion date is required")
      result = await prisma.vpsInstance.update({ where: { id }, data: { deletionAt, lifecycleMetadata: { ...asObj(vps.lifecycleMetadata), deletionPostponedAt: new Date().toISOString(), deletionPostponeReason: body.reason || null } } })
    } else if (action === "pause_reminders") {
      result = await prisma.vpsInstance.update({ where: { id }, data: { remindersPausedAt: body.paused === false ? null : new Date() } })
    } else if (action === "disable_automation") {
      result = await prisma.vpsInstance.update({ where: { id }, data: { automationPausedAt: body.paused === false ? null : new Date(), autoSuspendEnabled: body.autoSuspendEnabled !== false, autoDeleteEnabled: body.autoDeleteEnabled !== false } })
    } else if (action === "unsuspend") {
      result = await runAdminVmAction({ vpsId: vps.id, action: "unsuspend", actorEmail: String(admin.email) })
    } else {
      return NextResponse.json({ success: false, error: "Unsupported billing action" }, { status: 400 })
    }

    await audit(request, admin, vps, `VPS_BILLING_${action.toUpperCase()}`, oldValue, result)
    await createPanelLog({
      category: "BILLING",
      message: "vps_billing_lifecycle_updated",
      actorType: "admin",
      actorId: editorId,
      actorEmail: String(admin.email || ""),
      customerId: vps.customerId,
      orderId: vps.orderId,
      vpsInstanceId: vps.id,
      vmid: vps.vmid,
      metadata: { action, reason: body.reason || null },
    }).catch(() => null)
    return NextResponse.json({ success: true, action, result })
  } catch (error: any) {
    const supportCode = buildSupportCode("VM-BILL")
    return NextResponse.json({ success: false, error: safeApiErrorMessage(error, "Billing override failed"), supportCode }, { status: 400 })
  }
}
