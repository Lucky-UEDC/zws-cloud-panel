import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { scheduleProductSurfaceRevalidation } from "@/lib/product-revalidation"
import { canManageCatalog } from "@/lib/admin-rbac"
import { requireAdminFullAuth, requireSameOriginOrCsrf } from "@/lib/auth/guards"
import { requireSensitiveAdminMfa } from "@/lib/admin-sensitive-action"
import { PRODUCT_SAVE_TRANSACTION_OPTIONS, prepareProductSave, productDebugId, productErrorPayload, summarizeProductPayload } from "@/lib/admin-product-save"
import { getProductIpPoolAssignments, setProductIpPoolAssignmentsInTransaction } from "@/lib/ipam-admin"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(request: NextRequest) {
  const auth = await requireAdminFullAuth(request)
  if (!auth.ok) return auth.response
  const admin = { email: auth.session.email, role: auth.session.role }
  if (!admin?.email || !canManageCatalog(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const state = String(request.nextUrl.searchParams.get("state") || "").toLowerCase()

  const where = state === "deleted"
    ? { deletedAt: { not: null } }
    : state === "all"
      ? {}
      : state === "active"
        ? { deletedAt: null, isActive: true }
        : { deletedAt: null }
  const products = await prisma.product.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      categoryRef: { select: { id: true, title: true, slug: true } },
      subcategoryRef: { select: { id: true, title: true, slug: true } },
    },
  })
  return NextResponse.json({ products })
}

export async function POST(request: NextRequest) {
  const debugId = productDebugId()
  const auth = await requireSensitiveAdminMfa(request)
  if (!auth.ok) return auth.response
  const origin = await requireSameOriginOrCsrf(request)
  if (!origin.ok) return origin.response
  const admin = { email: auth.session.email, role: auth.session.role }
  if (!admin?.email || !canManageCatalog(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await request.json().catch(() => {
      throw Object.assign(new Error("Request body must be valid JSON"), { code: "invalid_json", status: 400 })
    })
    console.info("[admin-products] create incoming", { debugId, payload: summarizeProductPayload(body) })
    const prepared = await prepareProductSave({ body, adminEmail: String(admin.email), mode: "create" })
    console.info("[admin-products] create validated", { debugId, result: prepared.debugSummary })

    let assignments: any[] | undefined
    const product = await prisma.$transaction(async (tx) => {
      const saved = await tx.product.create({ data: prepared.data as any })
      if (prepared.ipAssignments !== undefined) {
        assignments = await setProductIpPoolAssignmentsInTransaction(tx, saved.id, prepared.ipAssignments)
      } else {
        assignments = await getProductIpPoolAssignments(saved.id, tx)
      }
      return saved
    }, PRODUCT_SAVE_TRANSACTION_OPTIONS)
    console.info("[admin-products] create committed", { debugId, id: product.id, slug: product.slug, assignments: assignments?.length })

    scheduleProductSurfaceRevalidation()

    return NextResponse.json({ success: true, product, assignments, debugId }, { status: 201 })
  } catch (error) {
    console.error("[admin-products] create failed", { debugId, error })
    const payload = productErrorPayload(error, debugId)
    const status = Number((error as any)?.status || payload.status)
    const body = (error as any)?.code === "invalid_json"
      ? { success: false, code: "invalid_json", error: "Request body must be valid JSON", message: "Request body must be valid JSON", debugId }
      : payload.body
    return NextResponse.json(body, { status })
  }
}
