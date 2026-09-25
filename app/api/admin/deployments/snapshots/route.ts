import { NextRequest, NextResponse } from "next/server"
import { exec } from "node:child_process"
import { promisify } from "node:util"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { buildSupportCode, safeApiErrorMessage } from "@/lib/api-error-safe"
import { sessionExpiredJson } from "@/lib/auth/session-expired-response"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

const execAsync = promisify(exec)

function snapshotModel() {
  return (prisma as any).deploymentSnapshot
}

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return sessionExpiredJson()
  const rows = await snapshotModel().findMany({ orderBy: { createdAt: "desc" }, take: 50 })
  return NextResponse.json({ success: true, snapshots: rows })
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return sessionExpiredJson()

  try {
    const body = await request.json().catch(() => ({}))
    const command = process.env.ZWS_APP_SNAPSHOT_COMMAND
    if (!command) {
      return NextResponse.json({
        success: false,
        error: "ZWS_APP_SNAPSHOT_COMMAND is not configured.",
        code: "snapshot_command_missing",
      }, { status: 400 })
    }

    const commitHash = String(body.commitHash || process.env.ZWS_DEPLOY_COMMIT || "manual")
    const releaseDir = typeof body.releaseDir === "string" ? body.releaseDir : process.env.ZWS_DEPLOY_RELEASE || null
    const backupRoot = typeof body.backupRoot === "string" ? body.backupRoot : process.env.ZWS_DEPLOY_BACKUP_ROOT || null
    const snapshotLabel = String(body.snapshotLabel || `zws-stable-${new Date().toISOString().replace(/[:.]/g, "-")}-${commitHash.slice(0, 12)}`)
    const metadataPath = `/tmp/${snapshotLabel}.json`

    const { stdout, stderr } = await execAsync(command, {
      timeout: Number(process.env.ZWS_APP_SNAPSHOT_TIMEOUT_MS || 600_000),
      maxBuffer: 2_000_000,
      env: {
        ...process.env,
        ZWS_DEPLOY_COMMIT: commitHash,
        ZWS_DEPLOY_RELEASE: releaseDir || "",
        ZWS_DEPLOY_BACKUP_ROOT: backupRoot || "",
        ZWS_DEPLOY_SNAPSHOT_LABEL: snapshotLabel,
        ZWS_DEPLOY_SNAPSHOT_METADATA: metadataPath,
      },
    })

    const row = await snapshotModel().create({
      data: {
        commitHash,
        releaseDir,
        backupRoot,
        snapshotLabel,
        status: "created",
        createdBy: String(admin.email),
        metadata: { stdout: stdout.slice(-4000), stderr: stderr.slice(-4000), metadataPath } as any,
      },
    })

    return NextResponse.json({ success: true, snapshot: row })
  } catch (error: any) {
    const supportCode = buildSupportCode("DEP-SNAP")
    return NextResponse.json({
      success: false,
      error: safeApiErrorMessage(error, "Deployment snapshot failed"),
      code: "snapshot_failed",
      supportCode,
    }, { status: 400 })
  }
}
