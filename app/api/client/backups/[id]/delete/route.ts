import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { createProxmoxClient, PROXMOX_LONG_TIMEOUT_MS } from "@/lib/proxmox"
import { rebuildBackupUsage } from "@/lib/billing/entitlements"
import { createAuditEvent } from "@/lib/audit-events"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

// Client-side backup deletion (Part 3.7 / Part 24 of the backup contract).
//
// Flow: confirm → authorize ownership → Proxmox delete → wait → verify →
// DB state update → authoritative usage recalculation → UI refresh.
// Usage is NEVER reduced before the storage artifact is actually removed.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now()
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customer?.sub) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })

  const { id } = await params
  const url = new URL(request.url)
  const vpsInstanceId = String(url.searchParams.get("vpsInstanceId") || "")
  const confirmation = String(url.searchParams.get("confirmation") || "").toUpperCase()
  if (!vpsInstanceId) return NextResponse.json({ success: false, error: "vpsInstanceId is required" }, { status: 400, headers: NO_CACHE_HEADERS })
  if (confirmation !== "DELETE") {
    return NextResponse.json({ success: false, error: 'Deletion requires the confirmation token "DELETE"' }, { status: 400, headers: NO_CACHE_HEADERS })
  }

  const instance = await prisma.vpsInstance.findFirst({ where: { id: vpsInstanceId, customerId, deletedAt: null } })
  if (!instance) return NextResponse.json({ success: false, error: "Server not found" }, { status: 404, headers: NO_CACHE_HEADERS })

  const backup = await prisma.vmBackup.findFirst({ where: { id, customerId, vpsInstanceId } })
  if (!backup) {
    await createAuditEvent({
      eventType: "backup_delete_failed",
      severity: "WARNING",
      actorType: "USER",
      actorId: String(customer.sub || ""),
      customerId,
      targetType: "vm_backup",
      targetId: id,
      vmid: Number(instance.vmid),
      vpsInstanceId: instance.id,
      reason: "backup_not_found",
      status: "failed",
    }).catch(() => null)
    return NextResponse.json({ success: false, error: "Backup not found" }, { status: 404, headers: NO_CACHE_HEADERS })
  }

  const statusKey = String(backup.status || "").toLowerCase()
  if (statusKey === "running" || statusKey === "queued") {
    return NextResponse.json({ success: false, error: "A backup in progress cannot be deleted." }, { status: 409, headers: NO_CACHE_HEADERS })
  }

  const metadata = (backup.metadata as Record<string, unknown>) || {}
  const volid = String(backup.backupPath || metadata.volid || "").trim()

  // Resolve the Proxmox node + storage that own this artifact (never trust a
  // browser-supplied node/storage value).
  let node: any = null
  let storage: string | null = null
  if (backup.schedule) {
    const policy = await prisma.vmBackupPolicy.findUnique({ where: { id: backup.schedule } })
    if (policy) {
      storage = policy.storage || null
      if (policy.nodeId) node = await prisma.proxmoxNode.findUnique({ where: { id: policy.nodeId } })
    }
  }
  if (!node && backup.proxmoxNodeId) node = await prisma.proxmoxNode.findUnique({ where: { id: backup.proxmoxNodeId } })
  if (!node && instance.proxmoxNodeId) node = await prisma.proxmoxNode.findUnique({ where: { id: instance.proxmoxNodeId } })

  const nodeReady = Boolean(node?.host && node?.nodeName)
  if (!volid || !nodeReady) {
    await createAuditEvent({
      eventType: "backup_delete_failed",
      severity: "WARNING",
      actorType: "USER",
      actorId: String(customer.sub || ""),
      customerId,
      targetType: "vm_backup",
      targetId: backup.id,
      vmid: backup.vmid != null ? Number(backup.vmid) : Number(instance.vmid),
      vpsInstanceId: instance.id,
      reason: !volid ? "artifact_unknown" : "node_unavailable",
      status: "failed",
    }).catch(() => null)
    return NextResponse.json(
      { success: false, error: !volid ? "This backup has no storage artifact to delete." : "The backup storage is not reachable right now. Try again later." },
      { status: 409, headers: NO_CACHE_HEADERS },
    )
  }

  const storageName = storage || String(volid.split(":")[0] || "")

  // 1) Delete the real Proxmox artifact.
  let artifactDeleted = false
  try {
    const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, {
      allowInsecureTls: Boolean(node.allowInsecureTls),
      timeoutMs: PROXMOX_LONG_TIMEOUT_MS,
    })
    await client.deleteVmBackup(node.nodeName, storageName, volid)
    artifactDeleted = true
  } catch (error: any) {
    // Treat "already gone" as deleted; any other failure aborts the delete so
    // the DB state and usage are NOT touched before storage confirms.
    const message = String(error?.message || "")
    const looksGone = /not found|doesn'?t exist|no such|404/i.test(message)
    if (!looksGone) {
      await createAuditEvent({
        eventType: "backup_delete_failed",
        severity: "ERROR",
        actorType: "USER",
        actorId: String(customer.sub || ""),
        customerId,
        targetType: "vm_backup",
        targetId: backup.id,
        vmid: backup.vmid != null ? Number(backup.vmid) : Number(instance.vmid),
        vpsInstanceId: instance.id,
        reason: "proxmox_delete_failed",
        metadata: { storage: storageName, artifact: volid, error: message.slice(0, 300) },
        status: "failed",
        durationMs: Date.now() - startedAt,
      }).catch(() => null)
      return NextResponse.json({ success: false, error: "The backup could not be deleted from storage. Try again later." }, { status: 502, headers: NO_CACHE_HEADERS })
    }
    artifactDeleted = true
  }

  // 2) Reflect deletion in the DB (never a hard row removal — keep audit trail).
  await prisma.vmBackup.update({
    where: { id: backup.id },
    data: {
      status: "cancelled",
      completedAt: backup.completedAt || new Date(),
      metadata: { ...metadata, deletedByCustomer: true, deletedAt: new Date().toISOString(), deletedByActor: "customer" },
    },
  })

  // 3) Reconcile the authoritative usage snapshot for this customer.
  const rebuilt = await rebuildBackupUsage({ customerId, persist: true }).catch(() => [])

  // 4) Audit trail.
  await createAuditEvent({
    eventType: "backup_deleted",
    severity: "SUCCESS",
    actorType: "USER",
    actorId: String(customer.sub || ""),
    customerId,
    targetType: "vm_backup",
    targetId: backup.id,
    vmid: backup.vmid != null ? Number(backup.vmid) : Number(instance.vmid),
    vpsInstanceId: instance.id,
    nodeId: node?.id || null,
    oldValue: { status: backup.status, sizeBytes: backup.sizeBytes != null ? String(backup.sizeBytes) : null },
    newValue: { status: "cancelled", deletedByCustomer: true, artifactDeleted },
    reason: "Customer requested backup deletion",
    status: "completed",
    durationMs: Date.now() - startedAt,
  }).catch(() => null)

  const summary = rebuilt.find((entry) => entry.customerId === customerId) || null
  return NextResponse.json(
    {
      success: true,
      deleted: { id: backup.id, artifactDeleted },
      usage: summary
        ? {
            backupCount: summary.after.backupCount,
            usedBytes: String(summary.after.usedBytes ?? 0),
            corrected: summary.corrected,
          }
        : null,
      message: "Backup deleted and storage usage updated.",
    },
    { headers: NO_CACHE_HEADERS },
  )
}