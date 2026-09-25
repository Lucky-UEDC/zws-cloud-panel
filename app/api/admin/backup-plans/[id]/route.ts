import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManageSettings } from "@/lib/admin-rbac"
import { createPanelLog } from "@/lib/panel-log"

export const dynamic = "force-dynamic"
export const revalidate = 0

function normalizePlanFields(body: any) {
  const fields: Record<string, any> = {
    name: body.name !== undefined ? String(body.name || "").trim() : undefined,
    slug: body.slug !== undefined ? String(body.slug || "").trim() : undefined,
    description: body.description !== undefined ? (body.description != null ? String(body.description).trim() || null : null) : undefined,
    active: body.active !== undefined ? Boolean(body.active) : undefined,
    archived: body.archived !== undefined ? Boolean(body.archived) : undefined,
    featured: body.featured !== undefined ? Boolean(body.featured) : undefined,
    price: body.price !== undefined ? Number(body.price) : undefined,
    currency: body.currency !== undefined ? String(body.currency || "INR").toUpperCase() : undefined,
    billingCycle: body.billingCycle !== undefined ? String(body.billingCycle || "monthly") : undefined,
    taxPercent: body.taxPercent !== undefined ? Number(body.taxPercent) : undefined,
    maxBackups: body.maxBackups !== undefined ? Math.max(0, Math.floor(Number(body.maxBackups))) : undefined,
    storageQuotaGb: body.storageQuotaGb !== undefined ? Math.max(0, Math.floor(Number(body.storageQuotaGb))) : undefined,
    manualBackupEnabled: body.manualBackupEnabled !== undefined ? Boolean(body.manualBackupEnabled) : undefined,
    automaticBackupEnabled: body.automaticBackupEnabled !== undefined ? Boolean(body.automaticBackupEnabled) : undefined,
    scheduleOptions: body.scheduleOptions !== undefined ? (Array.isArray(body.scheduleOptions) ? body.scheduleOptions.map(Number).filter(Number.isFinite) : []) : undefined,
    retentionCount: body.retentionCount !== undefined ? Math.max(0, Math.floor(Number(body.retentionCount))) : undefined,
    restoreEnabled: body.restoreEnabled !== undefined ? Boolean(body.restoreEnabled) : undefined,
    downloadEnabled: body.downloadEnabled !== undefined ? Boolean(body.downloadEnabled) : undefined,
    overageEnabled: body.overageEnabled !== undefined ? Boolean(body.overageEnabled) : undefined,
    overagePricePerGb: body.overagePricePerGb !== undefined ? Number(body.overagePricePerGb) : undefined,
    extraStoragePricePerGb: body.extraStoragePricePerGb !== undefined ? Number(body.extraStoragePricePerGb) : undefined,
    gracePeriodDays: body.gracePeriodDays !== undefined ? Math.max(0, Math.floor(Number(body.gracePeriodDays))) : undefined,
    maxStorageCapGb: body.maxStorageCapGb !== undefined && body.maxStorageCapGb !== null && body.maxStorageCapGb !== "" ? Math.max(0, Math.floor(Number(body.maxStorageCapGb))) : undefined,
  }
  for (const key of Object.keys(fields)) {
    if (fields[key] === undefined) delete fields[key]
  }
  return fields
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageSettings(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await params
  const plan = await prisma.backupPlan.findUnique({ where: { id } })
  if (!plan) return NextResponse.json({ success: false, error: "Backup plan not found" }, { status: 404 })

  try {
    const body = await request.json().catch(() => ({}))
    const fields = normalizePlanFields(body)
    if (fields.slug) {
      const dup = await prisma.backupPlan.findFirst({ where: { slug: fields.slug, id: { not: id } } }).catch(() => null)
      if (dup) return NextResponse.json({ success: false, error: "Plan slug is already in use" }, { status: 409 })
    }
    const updated = await prisma.backupPlan.update({ where: { id }, data: fields })
    await createPanelLog({
      category: "BILLING",
      message: "backup_plan_updated",
      metadata: { planId: id, changed: Object.keys(fields), admin: admin.email },
    }).catch(() => null)
    return NextResponse.json({ success: true, plan: updated })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Failed to update backup plan" }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageSettings(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await params
  const plan = await prisma.backupPlan.findUnique({ where: { id } })
  if (!plan) return NextResponse.json({ success: false, error: "Backup plan not found" }, { status: 404 })

  const subscriptions = await prisma.backupSubscription.count({ where: { planId: id } }).catch(() => 0)
  const archived = await prisma.backupPlan.update({ where: { id }, data: { archived: true, active: false } })
  await createPanelLog({
    category: "BILLING",
    message: "backup_plan_archived",
    metadata: { planId: id, activeSubscriptions: subscriptions, admin: admin.email },
  }).catch(() => null)
  return NextResponse.json({ success: true, archived: archived.archived, activeSubscriptions: subscriptions })
}