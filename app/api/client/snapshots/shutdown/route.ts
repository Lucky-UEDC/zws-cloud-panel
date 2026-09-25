import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { shutdownVmAndWait } from "@/lib/proxmox-vm-restore"
import { writeAuditLog } from "@/lib/audit-log"

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
  const name = String(body.name || "")
  if (!vpsInstanceId) return NextResponse.json({ error: "vpsInstanceId is required" }, { status: 400, headers: NO_CACHE_HEADERS })

  const instance = await prisma.vpsInstance.findFirst({ where: { id: vpsInstanceId, customerId, deletedAt: null } })
  if (!instance || !instance.vmid || !instance.proxmoxNodeId) return NextResponse.json({ error: "Server not found" }, { status: 404, headers: NO_CACHE_HEADERS })
  if (!name) return NextResponse.json({ error: "Snapshot name is required" }, { status: 400, headers: NO_CACHE_HEADERS })

  const node = await prisma.proxmoxNode.findUnique({ where: { id: instance.proxmoxNodeId } })
  if (!node || !node.host) return NextResponse.json({ error: "Proxmox node not found" }, { status: 404, headers: NO_CACHE_HEADERS })

  const result = await shutdownVmAndWait(node, node.nodeName, Number(instance.vmid)).catch((error: any) => ({
    ok: false,
    previousStatus: "unknown",
    status: "unknown",
    message: error?.message || "Failed to shut down the VM",
  }))

  await writeAuditLog({
    action: result.ok ? "vm.shutdown.before-rollback" : "vm.shutdown.failed",
    customerId: instance.customerId,
    targetType: "vm_snapshot",
    targetId: `${Number(instance.vmid)}-${name}`,
    newValue: { vmid: Number(instance.vmid), snapshotName: name, previousStatus: result.previousStatus, finalStatus: result.status },
    metadata: { vpsInstanceId: instance.id, actor: `client:${customerId}` },
  }).catch(() => null)

  return NextResponse.json(
    { success: result.ok, shutdown: { previousStatus: result.previousStatus, status: result.status, message: result.message || null } },
    { status: result.ok ? 200 : 409, headers: NO_CACHE_HEADERS },
  )
}