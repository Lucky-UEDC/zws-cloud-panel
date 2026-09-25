import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { buildSupportCode, safeApiErrorMessage } from "@/lib/api-error-safe"
import { sessionExpiredJson } from "@/lib/auth/session-expired-response"
import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"
import { getAdminFromCookies } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return sessionExpiredJson()

  try {
    const body = await request.json().catch(() => ({}))
    const action = String(body.action || "").trim()
    if (!action) {
      return NextResponse.json({ success: false, error: "Action is required", code: "invalid_request" }, { status: 400 })
    }

    if (action === "clear_logs") {
      const before = await prisma.panelLog.count()
      await prisma.panelLog.deleteMany({})
      await createPanelLog({
        category: "SYSTEM",
        message: "diagnostics_logs_cleared",
        actorType: "admin",
        actorEmail: String(admin.email),
        metadata: { cleared: before },
      })
      return NextResponse.json({ success: true, action, cleared: before })
    }

    if (action === "clear_failed_jobs") {
      const result = await prisma.provisioningJob.updateMany({
        where: { status: { in: ["failed", "waiting_for_admin"] } },
        data: {
          status: "cleared",
          displayStatus: "Cleared by diagnostics",
          completedAt: new Date(),
        },
      })
      await createPanelLog({
        category: "SYSTEM",
        message: "diagnostics_failed_jobs_cleared",
        actorType: "admin",
        actorEmail: String(admin.email),
        metadata: { count: result.count },
      })
      return NextResponse.json({ success: true, action, cleared: result.count })
    }

    if (action === "retry_failed_jobs") {
      const result = await prisma.provisioningJob.updateMany({
        where: { status: { in: ["failed", "waiting_for_admin", "retrying"] } },
        data: {
          status: "queued",
          displayStatus: "Queued",
          currentStep: "QUEUED",
          error: null,
          errorCode: null,
          nextRetryAt: null,
          completedAt: null,
          claimedAt: null,
          dedupeKey: null,
        },
      })
      await createPanelLog({
        category: "SYSTEM",
        message: "diagnostics_failed_jobs_retried",
        actorType: "admin",
        actorEmail: String(admin.email),
        metadata: { count: result.count },
      })
      return NextResponse.json({ success: true, action, queued: result.count })
    }

    if (action === "export_diagnostics") {
      const [logs, failedJobs, queueCounts] = await Promise.all([
        prisma.panelLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
        prisma.provisioningJob.findMany({
          where: { status: { in: ["failed", "waiting_for_admin", "running", "queued"] } },
          orderBy: { updatedAt: "desc" },
          take: 200,
        }),
        prisma.provisioningJob.groupBy({ by: ["status", "type"], _count: { _all: true } }),
      ])
      return NextResponse.json({
        success: true,
        exportedAt: new Date().toISOString(),
        logs,
        failedJobs,
        queueCounts,
      })
    }

    return NextResponse.json({ success: false, error: "Unsupported diagnostics action", code: "unsupported_action" }, { status: 400 })
  } catch (error: any) {
    const supportCode = buildSupportCode("DIAG-ACT")
    return NextResponse.json({
      success: false,
      error: safeApiErrorMessage(error, "Diagnostics action failed"),
      code: "diagnostics_action_failed",
      supportCode,
    }, { status: 400 })
  }
}
