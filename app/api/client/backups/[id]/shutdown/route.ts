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

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const vpsInstanceId = String(body.vpsInstanceId || "")
  if (!vpsInstanceId) return NextResponse.json({ error: "vpsInstanceId is required" }, { status: 400, headers: NO_CACHE_HEADERS })

  const backup = await prisma.vmBackup.findUnique({ where: { id } }).catch(() => null)
  if (!backup || String(backup.vpsInstanceId) !== vpsInstanceId || String(backup.customerId || "") !== customerId) {
    return NextResponse.json({ error: "Backup not found" }, { status: 404, headers: NO_CACHE_HEADERS })
  }

  const node = backup.proxmoxNodeId ? await prisma.proxmoxNode.findUnique({ where: { id: backup.proxmoxNodeId } }) : null
  if (!node || !node.host || !node.nodeName) return NextResponse.json({ error: "Proxmox node not found" }, { status: 404, headers: NO_CACHE_HEADERS })

  const result = await shutdownVmAndWait(node, node.nodeName, Number(backup.vmid)).catch((error: any) => ({
    ok: false,
    previousStatus: "unknown",
    status: "unknown",
    message: error?.message || "Failed to shut down the VM",
  }))

  await writeAuditLog({
    action: result.ok ? "vm.shutdown.before-restore" : "vm.shutdown.failed",
    customerId: customerId,
    targetType: "vm_backup",
    targetId: backup.id,
    newValue: { vmid: Number(backup.vmid), previousStatus: result.previousStatus, finalStatus: result.status },
    metadata: { vpsInstanceId, actor: `client:${customerId}` },
    ipAddress: request.headers.get("x-forwarded-for") || null,
    userAgent: request.headers.get("user-agent") || null,
  }).catch(() => null)

  return NextResponse.json(
    { success: result.ok, shutdown: { previousStatus: result.previousStatus, status: result.status, message: result.message || null } },
    { status: result.ok ? 200 : 409, headers: NO_CACHE_HEADERS },
  )
}