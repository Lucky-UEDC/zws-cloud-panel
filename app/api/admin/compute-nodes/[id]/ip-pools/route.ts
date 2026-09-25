import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getNodeIpPoolAssignments, getPoolProductAssignments, setNodeIpPoolAssignments } from "@/lib/ipam-admin"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { recoverIpBlockedProvisioning } from "@/lib/provisioning-ipam-recovery"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache", Expires: "0" }

async function requireAdmin() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return null
  return admin
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  const { id } = await params
  const [node, pools, assignments] = await Promise.all([
    prisma.proxmoxNode.findUnique({ where: { id }, select: { id: true, name: true, nodeName: true } }),
    prisma.ipPool.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
    getNodeIpPoolAssignments(id),
  ])
  if (!node) return NextResponse.json({ success: false, error: "Node not found" }, { status: 404, headers: NO_CACHE_HEADERS })
  return NextResponse.json({ success: true, node, pools, assignments }, { headers: NO_CACHE_HEADERS })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  try {
    let requested = body.assignments
    if (body.merge === true && body.targetPoolId) {
      const targetPoolId = String(body.targetPoolId)
      const existing = (await getNodeIpPoolAssignments(id)).filter((row) => row.poolId !== targetPoolId)
      requested = [
        ...existing.map((row) => ({ poolId: row.poolId, priority: row.priority, active: row.active })),
        ...(Array.isArray(body.assignments) ? body.assignments : []),
      ]
    }
    const assignments = await setNodeIpPoolAssignments(id, requested)
    const activePoolIds = Array.from(new Set(assignments.filter((row: any) => row.active !== false).map((row: any) => String(row.poolId)).filter(Boolean)))
    const productAssignments = (await Promise.all(activePoolIds.map((poolId) => getPoolProductAssignments(poolId).catch(() => [])))).flat()
    let productIds = Array.from(new Set(productAssignments.map((row) => row.productId).filter(Boolean)))
    if (!productIds.length) {
      const blockedProducts = await prisma.provisioningJob.findMany({
        where: {
          type: "provision",
          status: "waiting_for_admin",
          OR: [{ errorCode: "IP_POOL_UNAVAILABLE" }, { error: { contains: "No IP pool assigned" } }],
          order: { status: { in: ["paid", "payment_verified", "active"] }, productId: { not: null } },
        },
        select: { order: { select: { productId: true } } },
        take: 50,
      })
      productIds = Array.from(new Set(blockedProducts.map((row) => row.order?.productId).filter(Boolean) as string[]))
    }
    const recovery = await recoverIpBlockedProvisioning({ productIds, actor: `admin:${admin.email}:ipam_node_assignment` }).catch(() => null)
    return NextResponse.json({ success: true, assignments, recovery }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Failed to save node IP pools" }, { status: 400, headers: NO_CACHE_HEADERS })
  }
}
