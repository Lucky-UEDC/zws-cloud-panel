import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { restoreVmFromBackup } from "@/lib/proxmox-vm-restore"
import { runOperationBackground } from "@/lib/operation-progress"
import { createProxmoxClient } from "@/lib/proxmox"
import { randomUUID } from "crypto"
import { resolveBackupEntitlement } from "@/lib/billing/entitlements"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const confirmation = String(body.confirmation || "")
  const vpsInstanceId = String(body.vpsInstanceId || "")

  if (!vpsInstanceId) return NextResponse.json({ error: "vpsInstanceId is required" }, { status: 400, headers: NO_CACHE_HEADERS })
  if (String(confirmation || "").trim().toUpperCase() !== "RESTORE") {
    return NextResponse.json({ error: 'Restore requires the explicit confirmation token "RESTORE"' }, { status: 400, headers: NO_CACHE_HEADERS })
  }

  const backup = await prisma.vmBackup.findUnique({ where: { id } }).catch(() => null)
  if (!backup) return NextResponse.json({ error: "Backup not found" }, { status: 404, headers: NO_CACHE_HEADERS })
  if (String(backup.vpsInstanceId) !== String(vpsInstanceId)) return NextResponse.json({ error: "Backup does not belong to this instance" }, { status: 403, headers: NO_CACHE_HEADERS })
  if (String(backup.customerId || "") !== String(customerId)) return NextResponse.json({ error: "Backup does not belong to this account" }, { status: 403, headers: NO_CACHE_HEADERS })
  if (backup.status !== "completed") return NextResponse.json({ error: `Only completed backups can be restored (current status=${backup.status})` }, { status: 409, headers: NO_CACHE_HEADERS })

  const entitlementResult = await resolveBackupEntitlement(customerId)
  if (!entitlementResult.entitled) {
    return NextResponse.json({ success: false, error: entitlementResult.reason || "No backup plan active on this account. Purchase a backup plan to continue." }, { status: 403, headers: NO_CACHE_HEADERS })
  }
  if (entitlementResult.entitlement && entitlementResult.entitlement.restoreEnabled === false) {
    return NextResponse.json({ success: false, error: "Backup restore is not enabled on your current plan." }, { status: 403, headers: NO_CACHE_HEADERS })
  }

  const instance = await prisma.vpsInstance.findUnique({ where: { id: vpsInstanceId } })
  if (!instance || !instance.vmid) return NextResponse.json({ error: "Instance not found" }, { status: 404, headers: NO_CACHE_HEADERS })

  const node = backup.proxmoxNodeId ? await prisma.proxmoxNode.findUnique({ where: { id: backup.proxmoxNodeId } }) : null
  if (!node || !node.host || !node.nodeName) return NextResponse.json({ error: "Proxmox node not found" }, { status: 404, headers: NO_CACHE_HEADERS })

  const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, { allowInsecureTls: node.allowInsecureTls })
  const runtime = await client.getVMStatus(node.nodeName, Number(instance.vmid)).catch(() => null)
  const status = String(runtime?.status || "").toLowerCase()
  if (status !== "stopped") {
    return NextResponse.json(
      { success: false, error: `The server is currently ${status === "running" ? "running" : "in '" + status + "' state"}. It must be powered off before restore.` },
      { status: 409, headers: NO_CACHE_HEADERS },
    )
  }

  const operationId = randomUUID()
  runOperationBackground({
    operationId,
    kind: "restore",
    vpsInstanceId: instance.id,
    customerId,
    vmId: Number(instance.vmid),
    headline: `Restoring from backup ${backup.id.split("-")[0] || "backup"}`,
    nodeName: node.nodeName,
    run: async (report) => {
      report({ phase: "Starting restore", status: "running" as const })
      const result = await restoreVmFromBackup({
        customerId,
        vpsInstanceId,
        backupId: id,
        confirmation,
        actor: "client",
        onProgress: (patch) => report({ ...patch, status: "running" as const }),
      })
      if (result.status === "completed") {
        report({ phase: "Restore complete", status: "completed" as const, result: { taskId: result.taskId, verifyStatus: result.verifyStatus } })
      } else if (result.status === "unsupported" || result.status === "failed") {
        report({ phase: "Restore failed", status: "failed" as const, error: result.reason || null })
        throw new Error(result.reason || "Restore failed")
      }
    },
  })

  return NextResponse.json(
    { success: true, restore: { taskId: null, status: "running", verifyStatus: null, operationId }, operationId },
    { headers: NO_CACHE_HEADERS },
  )
}