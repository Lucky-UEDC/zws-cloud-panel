import { NextResponse } from "next/server"
import { getNodeLiveMetrics, safeMonitoringError } from "@/lib/compute-node-monitoring"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const { id } = await params
  try {
    const metrics = await getNodeLiveMetrics(id)
    return NextResponse.json({ success: true, ...metrics }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    const missing = String(error?.message || "") === "Node not found"
    return NextResponse.json(
      {
        success: !missing,
        status: "failed",
        health: { status: "failed", critical: true },
        error: missing ? "Node not found" : safeMonitoringError(error),
        refreshedAt: new Date().toISOString(),
      },
      { status: missing ? 404 : 200, headers: NO_CACHE_HEADERS },
    )
  }
}
