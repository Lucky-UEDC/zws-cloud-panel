import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getProductIpPoolAssignments, setProductIpPoolAssignments } from "@/lib/ipam-admin"
import { scheduleProductSurfaceRevalidation } from "@/lib/product-revalidation"
import { canManageCatalog } from "@/lib/admin-rbac"
import { requireAdminFullAuth, requireSameOriginOrCsrf } from "@/lib/auth/guards"
import { requireSensitiveAdminMfa } from "@/lib/admin-sensitive-action"
import { recoverIpBlockedProvisioning } from "@/lib/provisioning-ipam-recovery"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache", Expires: "0" }

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminFullAuth(request)
  if (!auth.ok) return auth.response
  const admin = { email: auth.session.email, role: auth.session.role }
  if (!admin.email || !canManageCatalog(admin.role)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  const { id } = await params
  const [product, pools, assignments] = await Promise.all([
    prisma.product.findUnique({ where: { id }, select: { id: true, name: true, premiumIpEnabled: true } }),
    prisma.ipPool.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
    getProductIpPoolAssignments(id),
  ])
  if (!product) return NextResponse.json({ success: false, error: "Product not found" }, { status: 404, headers: NO_CACHE_HEADERS })
  return NextResponse.json({ success: true, product, pools, assignments }, { headers: NO_CACHE_HEADERS })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSensitiveAdminMfa(request)
  if (!auth.ok) return auth.response
  const origin = await requireSameOriginOrCsrf(request)
  if (!origin.ok) return origin.response
  const admin = { email: auth.session.email, role: auth.session.role }
  if (!admin.email || !canManageCatalog(admin.role)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  try {
    let requested = body.assignments
    if (body.merge === true && body.targetPoolId) {
      const targetPoolId = String(body.targetPoolId)
      const existing = (await getProductIpPoolAssignments(id)).filter((row) => row.poolId !== targetPoolId)
      requested = [
        ...existing.map((row) => ({ poolId: row.poolId, priority: row.priority, active: row.active })),
        ...(Array.isArray(body.assignments) ? body.assignments : []),
      ]
    }
    const assignments = await setProductIpPoolAssignments(id, requested, body.premiumIpEnabled)
    scheduleProductSurfaceRevalidation()
    const recovery = await recoverIpBlockedProvisioning({ productIds: [id], actor: `admin:${admin.email}:ipam_product_assignment` }).catch(() => null)
    return NextResponse.json({ success: true, assignments, recovery }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Failed to save product IP pools" }, { status: 400, headers: NO_CACHE_HEADERS })
  }
}
