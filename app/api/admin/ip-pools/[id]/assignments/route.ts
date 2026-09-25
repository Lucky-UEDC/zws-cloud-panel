import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { requireSensitiveAdminMfa } from "@/lib/admin-sensitive-action"
import { requireSameOriginOrCsrf } from "@/lib/auth/guards"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { recoverIpBlockedProvisioning } from "@/lib/provisioning-ipam-recovery"
import { setIpPoolAssignments } from "@/lib/ipam-admin"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSensitiveAdminMfa(request)
  if (!auth.ok) return auth.response
  const origin = await requireSameOriginOrCsrf(request)
  if (!origin.ok) return origin.response
  if (!auth.session.email || !canAccessAdminApi(auth.session.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const assignments = await setIpPoolAssignments(id, {
      nodeAssignments: body.nodeAssignments,
      productAssignments: body.productAssignments,
    })
    const productIds = assignments.productAssignments.map((row) => row.productId).filter(Boolean)
    const recovery = await recoverIpBlockedProvisioning({
      productIds,
      actor: `admin:${auth.session.email}:ip_pool_atomic_assignment`,
    }).catch((error: any) => ({ scanned: 0, recovered: 0, error: error?.message || "Recovery scan failed" }))
    return NextResponse.json({ success: true, ...assignments, recovery }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Failed to save IP pool assignments" }, { status: 400, headers: NO_CACHE_HEADERS })
  }
}
