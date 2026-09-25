import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { resolveBackupTargetForInstance, startVmBackupDirect } from "@/lib/proxmox-backup"
import { writeAuditLog } from "@/lib/audit-log"
import { resolveBackupEntitlement, computeBackupUsageSummary } from "@/lib/billing/entitlements"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export async function POST(request: NextRequest) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })

  const body = await request.json().catch(() => ({}))
  const vpsInstanceId = String(body.vpsInstanceId || "")
  const ip = request.headers.get("x-forwarded-for") || null
  const userAgent = request.headers.get("user-agent") || null

  if (!vpsInstanceId) return NextResponse.json({ error: "vpsInstanceId is required" }, { status: 400, headers: NO_CACHE_HEADERS })

  const instance = await prisma.vpsInstance.findFirst({
    where: { id: vpsInstanceId, customerId, deletedAt: null, vmid: { gt: 0 } },
  })
  if (!instance) return NextResponse.json({ error: "Instance not found" }, { status: 404, headers: NO_CACHE_HEADERS })

  const entitlementResult = await resolveBackupEntitlement(customerId)
  if (!entitlementResult.entitled) {
    return NextResponse.json({ success: false, error: entitlementResult.reason || "No backup plan active on this account. Purchase a backup plan to continue." }, { status: 403, headers: NO_CACHE_HEADERS })
  }
  const usage = await computeBackupUsageSummary(customerId, { entitlement: entitlementResult.entitlement })
  if (usage.capReached) {
    return NextResponse.json({ success: false, error: "Backup storage cap reached. Reduce stored backup data or increase your quota." }, { status: 409, headers: NO_CACHE_HEADERS })
  }
  // Part 4.7: when the active plan does NOT allow overage, storage quota itself
  // is a hard limit for new backups. Overage-enabled plans may proceed up to
  // the configured cap (billed overage is materialized by reconciliation).
  if (usage.entitled && !usage.overageEnabled && usage.storageQuotaBytes > 0n && usage.usedBytes >= usage.storageQuotaBytes) {
    return NextResponse.json({ success: false, error: "Backup storage quota reached. Your plan does not allow overage — delete backups or increase your storage quota." }, { status: 409, headers: NO_CACHE_HEADERS })
  }
  if (usage.entitled && usage.backupsRemaining !== null && usage.backupsRemaining <= 0) {
    return NextResponse.json({ success: false, error: "Backup limit reached. Delete an existing backup to continue." }, { status: 409, headers: NO_CACHE_HEADERS })
  }

  const target = await resolveBackupTargetForInstance({ nodeId: instance.proxmoxNodeId, vmid: Number(instance.vmid) })
  if (!target) {
    return NextResponse.json({ error: "No backup storage is configured for this VM" }, { status: 409, headers: NO_CACHE_HEADERS })
  }

  let started
  try {
    started = await startVmBackupDirect({
      nodeId: target.nodeId,
      vmid: Number(instance.vmid),
      vpsInstanceId: instance.id,
      customerId: instance.customerId,
      storage: target.storage,
      policyId: target.policy?.id || null,
      mode: target.policy?.mode || "snapshot",
      compress: target.policy?.compress || null,
      actor: `client:${customerId}`,
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Failed to start backup" }, { status: error?.status || 500, headers: NO_CACHE_HEADERS })
  }

  writeAuditLog({
    action: "vm.backup.started",
    customerId: instance.customerId,
    targetType: "vm_backup",
    targetId: started.backupId,
    newValue: { vmid: Number(instance.vmid), storage: started.storage, upid: started.upid },
    metadata: { vpsInstanceId: instance.id, actor: customerId },
    ipAddress: ip,
    userAgent,
  }).catch(() => null)

  return NextResponse.json(
    {
      success: true,
      accepted: true,
      backupId: started.backupId,
      storage: started.storage,
      storageConfig: started.storageConfig
        ? { totalBytes: String(started.storageConfig.totalBytes), usedBytes: String(started.storageConfig.usedBytes), freeBytes: String(started.storageConfig.freeBytes) }
        : null,
      message: "Backup started. Progress updates automatically as the backup runs.",
    },
    { headers: NO_CACHE_HEADERS },
  )
}