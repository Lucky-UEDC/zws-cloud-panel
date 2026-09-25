import { NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { prisma } from "@/lib/db"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { retryProvisioningQueueJob } from "@/lib/provision"
import { getAdminFromCookies } from "@/lib/server-auth"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const rawNodeId = String(body?.nodeId || body?.proxmoxNodeId || "").trim()
    let nodeId: string | null | undefined
    if (rawNodeId === "auto") nodeId = null
    else if (rawNodeId === "product_default") {
      const existing = await prisma.provisioningJob.findUnique({ where: { id }, select: { order: { select: { proxmoxNodeId: true, product: { select: { defaultNodeId: true } } } } } })
      nodeId = existing?.order?.product?.defaultNodeId || existing?.order?.proxmoxNodeId || undefined
    } else if (rawNodeId) {
      nodeId = rawNodeId
    }
    const options = {
      ...(rawNodeId && nodeId !== undefined ? { nodeId } : {}),
      ipAssignmentMode: body?.ipAssignmentMode || (body?.requestedIp ? "manual" : undefined),
      poolId: body?.poolId || null,
      requestedIp: body?.requestedIp || null,
      forceIpOverride: body?.forceIpOverride === true,
    }
    const job = await retryProvisioningQueueJob(id, String(admin.email), options)
    return NextResponse.json({ success: true, job }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Retry failed" }, { status: 400, headers: NO_CACHE_HEADERS })
  }
}
