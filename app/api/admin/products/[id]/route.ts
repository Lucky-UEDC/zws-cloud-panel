import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { scheduleProductSurfaceRevalidation } from "@/lib/product-revalidation"
import { canManageCatalog } from "@/lib/admin-rbac"
import { requireAdminFullAuth, requireSameOriginOrCsrf } from "@/lib/auth/guards"
import { requireSensitiveAdminMfa } from "@/lib/admin-sensitive-action"
import { PRODUCT_SAVE_TRANSACTION_OPTIONS, prepareProductSave, productDebugId, productErrorPayload, summarizeProductPayload } from "@/lib/admin-product-save"
import { getProductIpPoolAssignments, setProductIpPoolAssignmentsInTransaction } from "@/lib/ipam-admin"
import { recoverIpBlockedProvisioning } from "@/lib/provisioning-ipam-recovery"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const request = _ as NextRequest
  const auth = await requireAdminFullAuth(request)
  if (!auth.ok) return auth.response
  const admin = { email: auth.session.email, role: auth.session.role }
  if (!admin?.email || !canManageCatalog(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      categoryRef: true,
      subcategoryRef: true,
    },
  })
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 })
  return NextResponse.json({ product })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const debugId = productDebugId()
  const auth = await requireSensitiveAdminMfa(request)
  if (!auth.ok) return auth.response
  const origin = await requireSameOriginOrCsrf(request)
  if (!origin.ok) return origin.response
  const admin = { email: auth.session.email, role: auth.session.role }
  if (!admin?.email || !canManageCatalog(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  try {
    const body = await request.json().catch(() => {
      throw Object.assign(new Error("Request body must be valid JSON"), { code: "invalid_json", status: 400 })
    })
    console.info("[admin-products] save incoming", { debugId, id, payload: summarizeProductPayload(body) })
    const existing = await prisma.product.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ success: false, code: "not_found", error: "Product not found", debugId }, { status: 404 })
    const prepared = await prepareProductSave({ body, adminEmail: String(admin.email), mode: "update", existing: existing as any })
    console.info("[admin-products] save validated", { debugId, id, result: prepared.debugSummary })

    let assignments: any[] | undefined
    const product = await prisma.$transaction(async (tx) => {
      const saved = await tx.product.update({ where: { id }, data: prepared.data as any })
      if (prepared.ipAssignments !== undefined) {
        assignments = await setProductIpPoolAssignmentsInTransaction(tx, id, prepared.ipAssignments)
      } else {
        assignments = await getProductIpPoolAssignments(id, tx)
      }
      return saved
    }, PRODUCT_SAVE_TRANSACTION_OPTIONS)
    console.info("[admin-products] save committed", { debugId, id: product.id, slug: product.slug, updatedAt: product.updatedAt, assignments: assignments?.length })

    scheduleProductSurfaceRevalidation()
    const recovery = prepared.ipAssignments !== undefined
      ? await recoverIpBlockedProvisioning({ productIds: [id], actor: `admin:${admin.email}:product_save` }).catch(() => null)
      : null

    return NextResponse.json({ success: true, product, assignments, recovery, debugId })
  } catch (error) {
    console.error("[admin-products] save failed", { debugId, id, error })
    const payload = productErrorPayload(error, debugId)
    const status = Number((error as any)?.status || payload.status)
    const body = (error as any)?.code === "invalid_json"
      ? { success: false, code: "invalid_json", error: "Request body must be valid JSON", message: "Request body must be valid JSON", debugId }
      : payload.body
    return NextResponse.json(body, { status })
  }
}

export async function PATCH() {
  return NextResponse.json({ success: false, error: "Product archive updates have been removed. Use draft, hidden, or delete instead." }, { status: 410 })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSensitiveAdminMfa(request)
  if (!auth.ok) return auth.response
  const origin = await requireSameOriginOrCsrf(request)
  if (!origin.ok) return origin.response
  const admin = { email: auth.session.email, role: auth.session.role }
  if (!admin?.email || !canManageCatalog(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  try {
    const product = await prisma.$transaction(async (tx) => tx.product.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: "deleted",
        isActive: false,
        visibility: "hidden",
      },
    }), PRODUCT_SAVE_TRANSACTION_OPTIONS)

    scheduleProductSurfaceRevalidation()

    return NextResponse.json({ success: true, product })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Failed to delete product" }, { status: 500 })
  }
}
