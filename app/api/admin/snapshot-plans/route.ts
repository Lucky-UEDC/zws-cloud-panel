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
    name: body.name !== undefined ? String(body.name || "").trim() : undefined,
    slug: body.slug !== undefined ? String(body.slug || "").trim() : undefined,
    description: body.description !== undefined ? (body.description != null ? String(body.description).trim() || null : null) : undefined,
    active: body.active !== undefined ? Boolean(body.active) : undefined,
    archived: body.archived !== undefined ? Boolean(body.archived) : undefined,
    model: body.model !== undefined ? String(body.model || "per_snapshot") : undefined,
    price: body.price !== undefined ? Number(body.price) : undefined,
    currency: body.currency !== undefined ? String(body.currency || "INR").toUpperCase() : undefined,
    billingCycle: body.billingCycle !== undefined ? String(body.billingCycle || "monthly") : undefined,
    taxPercent: body.taxPercent !== undefined ? Number(body.taxPercent) : undefined,
    includedSnapshots: body.includedSnapshots !== undefined ? Math.max(0, Math.floor(Number(body.includedSnapshots))) : undefined,
    overageSnapshotPrice: body.overageSnapshotPrice !== undefined ? Number(body.overageSnapshotPrice) : undefined,
    maxSnapshots: body.maxSnapshots !== undefined && body.maxSnapshots !== null && body.maxSnapshots !== "" ? Math.max(0, Math.floor(Number(body.maxSnapshots))) : undefined,
    gracePeriodDays: body.gracePeriodDays !== undefined ? Math.max(0, Math.floor(Number(body.gracePeriodDays))) : undefined,
    restoreEnabled: body.restoreEnabled !== undefined ? Boolean(body.restoreEnabled) : undefined,
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
  const plans = await prisma.snapshotPlan.findMany({ orderBy: [{ archived: "asc" }, { price: "asc" }] })
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
    const existing = await prisma.snapshotPlan.findUnique({ where: { slug } }).catch(() => null)
    if (existing) slug = `${baseSlug}-${Date.now().toString(36)}`

    const plan = await prisma.snapshotPlan.create({
      data: {
        ...fields as any,
        slug,
        taxPercent: fields.taxPercent ?? 18,
        price: fields.price ?? 0,
        includedSnapshots: fields.includedSnapshots ?? 0,
        overageSnapshotPrice: fields.overageSnapshotPrice ?? fields.price ?? 0,
        active: fields.active ?? true,
        archived: fields.archived ?? false,
      },
    })
    await createPanelLog({
      category: "BILLING",
      message: "snapshot_plan_created",
      metadata: { planId: plan.id, slug, price: Number(plan.price), admin: admin.email },
    }).catch(() => null)
    return NextResponse.json({ success: true, plan })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Failed to create snapshot plan" }, { status: 500 })
  }
}