import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromRequest, getClientFromRequest } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { serializeVmActionJob } from "@/lib/vm-action-jobs"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const [admin, customer] = await Promise.all([getAdminFromRequest(request), getClientFromRequest(request)])
  const isAdmin = Boolean(admin?.email && canAccessAdminApi(admin.role))
  const customerId = isAdmin ? undefined : String(customer?.sub || "")
  if (!isAdmin && !customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const { jobId } = await params
  const job = await (prisma as any).vmActionJob.findFirst({ where: { id: jobId, ...(customerId ? { customerId } : {}) } })
  if (!job) return NextResponse.json({ success: false, code: "JOB_NOT_FOUND", error: "Job not found" }, { status: 404 })
  return NextResponse.json({ success: true, ...serializeVmActionJob(job) }, { headers: { "Cache-Control": "no-store" } })
}
