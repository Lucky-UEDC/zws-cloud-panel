import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManageSettings } from "@/lib/admin-rbac"
import { createPanelLog } from "@/lib/panel-log"

export const dynamic = "force-dynamic"
export const revalidate = 0

function slugify(value: string) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function normalizePlanFields(body: any) {
  const fields: Record<string, any> = {
    name: String(body.name || "").trim(),
    slug: String(body.slug || "").trim() || undefined,
    description: body.description != null ? String(body.description).trim() || null : undefined,
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

export async function GET(_request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageSettings(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  const plans = await prisma.backupPlan.findMany({ orderBy: [{ archived: "asc" }, { price: "asc" }] })
  return NextResponse.json({ success: true, plans })
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageSettings(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  try {
    const body = await request.json().catch(() => ({}))
    const fields = normalizePlanFields(body)
    if (!fields.name) return NextResponse.json({ success: false, error: "name is required" }, { status: 400 })
    const baseSlug = (fields.slug as string) || slugify(fields.name)
    let slug = baseSlug
    const existing = await prisma.backupPlan.findUnique({ where: { slug } }).catch(() => null)
    if (existing) slug = `${baseSlug}-${Date.now().toString(36)}`

    const plan = await prisma.backupPlan.create({
      data: {
        ...fields as any,
        slug,
        scheduleOptions: (fields.scheduleOptions ?? [180, 360, 720, 1440]) as any,
        taxPercent: fields.taxPercent ?? 18,
        storageQuotaGb: fields.storageQuotaGb ?? 100,
        maxBackups: fields.maxBackups ?? 10,
        retentionCount: fields.retentionCount ?? 10,
        price: fields.price ?? 0,
        active: fields.active ?? true,
        archived: fields.archived ?? false,
      },
    })
    await createPanelLog({
      category: "Billing",
      message: "backup_plan_created",
      metadata: { planId: plan.id, slug, price: Number(plan.price), admin: admin.email },
    }).catch(() => null)
    return NextResponse.json({ success: true, plan })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Failed to create backup plan" }, { status: 500 })
  }
}