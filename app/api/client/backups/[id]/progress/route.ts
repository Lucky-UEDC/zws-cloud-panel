import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { finalizeBackupFromTask } from "@/lib/proxmox-backup"
import { snapshotTaskProgress } from "@/lib/task-progress"
import type { BackupVerification } from "@/lib/proxmox-backup"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })

  const { id } = await params

  const backup = await prisma.vmBackup.findUnique({ where: { id } }).catch(() => null)
  if (!backup) return NextResponse.json({ error: "Backup not found" }, { status: 404, headers: NO_CACHE_HEADERS })

  const owned = backup.customerId !== null && String(backup.customerId) === customerId
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_CACHE_HEADERS })

  // Finalize first: the DB row becomes the source of truth when the task ends.
  const finalized = await finalizeBackupFromTask(id).catch(() => null)

  // Re-read AFTER finalization so the response reflects the persisted state
  // (the pre-finalize snapshot above may still say "running").
  const fresh = await prisma.vmBackup.findUnique({
    where: { id },
    select: { status: true, metadata: true, sizeBytes: true, backupPath: true, destination: true, completedAt: true, startedAt: true, createdAt: true },
  }).catch(() => null)

  const row = fresh || backup
  const rowStatus = String(row.status || "queued").toLowerCase()
  const terminal = ["completed", "failed", "cancelled"].includes(rowStatus)
  const metadata = (row.metadata as Record<string, unknown>) || {}
  const verification = (metadata.verification || null) as BackupVerification | null

  const upid = String(metadata.upid || "")
  const node = backup.proxmoxNodeId ? await prisma.proxmoxNode.findUnique({ where: { id: backup.proxmoxNodeId } }) : null

  // For terminal backups the persisted task state is authoritative: skip extra
  // Proxmox calls entirely and map directly to the final view.
  let progress: Record<string, unknown> = {}
  if (terminal) {
    const completed = rowStatus === "completed"
    const failed = rowStatus === "failed"
    progress = {
      status: rowStatus,
      percent: completed ? 100 : null,
      phase: completed ? "Backup completed" : failed ? "Backup failed" : "Backup cancelled",
      transferredBytes: null,
      totalBytes: null,
      transferredLabel: null,
      totalLabel: null,
      speedLabel: null,
      elapsedSeconds: 0,
      taskId: null,
      logTail: [],
      verified: completed && verification?.passed !== false,
      error: failed ? String(metadata.error || "Backup failed") : null,
    }
  } else if (node && upid) {
    const live = await snapshotTaskProgress(node.nodeName, upid).catch(() => null)
    if (live && !["completed", "failed", "cancelled"].includes(String(live.status))) {
      progress = {
        status: String(live.status || "running"),
        percent: live.percent,
        phase: live.phase,
        transferredBytes: live.transferredBytes,
        totalBytes: live.totalBytes,
        transferredLabel: live.transferredLabel,
        totalLabel: live.totalLabel,
        speedLabel: live.speedLabel,
        elapsedSeconds: live.elapsedSeconds,
        taskId: live.taskId,
        logTail: live.logTail,
        verified: false,
        error: null,
      }
    } else if (live) {
      // Race: snapshot saw a terminal state that the DB write has not
      // landed yet. Report the live terminal state without claiming 97%.
      progress = {
        status: live.status,
        percent: live.status === "completed" ? 100 : null,
        phase: live.status === "completed" ? "Backup completed" : "Backup failed",
        transferredBytes: null,
        totalBytes: null,
        transferredLabel: null,
        totalLabel: null,
        speedLabel: null,
        elapsedSeconds: 0,
        taskId: null,
        logTail: [],
        verified: live.status === "completed",
        error: live.status === "failed" ? String(live.error || "Backup failed") : null,
      }
    }
  }

  const response = {
    success: true,
    backupId: id,
    status: rowStatus,
    progress,
    sizeBytes: row.sizeBytes ? String(row.sizeBytes) : null,
    // Internal storage identifiers (destination, volid) are intentionally not
    // exposed to the customer — the admin panel shows them where required.
    verification: verification
      ? { passed: verification.passed, reason: verification.reason || null, sizeBytes: verification.sizeBytes ?? null }
      : null,
    completedAt: row.completedAt?.toISOString() || null,
    startedAt: row.startedAt?.toISOString() || null,
    finalized: finalized?.justFinalized === true,
  }

  return NextResponse.json(response, { headers: NO_CACHE_HEADERS })
}