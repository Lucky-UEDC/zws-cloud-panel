import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { deleteVmSnapshot, rollbackVmSnapshot } from "@/lib/proxmox-snapshots"
import { runOperationBackground } from "@/lib/operation-progress"
import { randomUUID } from "crypto"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })

  const { name } = await params
  const body = await request.json().catch(() => ({}))
  const action = String(body.action || "rollback")
  const vpsInstanceId = String(body.vpsInstanceId || "")
  const confirmation = String(body.confirmation || "").toUpperCase()

  if (!vpsInstanceId) return NextResponse.json({ error: "vpsInstanceId is required" }, { status: 400, headers: NO_CACHE_HEADERS })

  const instance = await prisma.vpsInstance.findFirst({
    where: { id: vpsInstanceId, customerId, deletedAt: null },
    include: { proxmoxNode: { select: { nodeName: true } } },
  })
  if (!instance || !instance.vmid || !instance.proxmoxNodeId) return NextResponse.json({ error: "Server not found" }, { status: 404, headers: NO_CACHE_HEADERS })
  if (!name) return NextResponse.json({ error: "Snapshot name is required" }, { status: 400, headers: NO_CACHE_HEADERS })

  try {
    if (action === "rollback") {
      if (confirmation !== "ROLLBACK") return NextResponse.json({ error: 'Rollback requires the explicit confirmation token "ROLLBACK"' }, { status: 400, headers: NO_CACHE_HEADERS })
      const operationId = randomUUID()
      runOperationBackground({
        operationId,
        kind: "rollback",
        vpsInstanceId: instance.id,
        customerId,
        vmId: Number(instance.vmid),
        headline: `Rolling back to snapshot "${name}"`,
        nodeName: (instance.proxmoxNode?.nodeName as string | null) || undefined,
        run: async (report) => {
          report({ phase: "Rolling back VM state", status: "running" as const })
          const result = await rollbackVmSnapshot({ nodeId: instance.proxmoxNodeId!, vmid: Number(instance.vmid), name, actor: "client" })
          report({ phase: "Rollback complete", status: "completed" as const, result: result as Record<string, unknown> })
        },
      })
      return NextResponse.json({ success: true, rollback: { queued: true }, operationId }, { headers: NO_CACHE_HEADERS })
    }
    return NextResponse.json({ error: `Unknown action ${action}` }, { status: 400, headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Failed" }, { status: error?.status || 500, headers: NO_CACHE_HEADERS })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })

  const { name } = await params
  const url = new URL(request.url)
  const vpsInstanceId = String(url.searchParams.get("vpsInstanceId") || "")

  if (!vpsInstanceId) return NextResponse.json({ error: "vpsInstanceId is required" }, { status: 400, headers: NO_CACHE_HEADERS })

  const instance = await prisma.vpsInstance.findFirst({ where: { id: vpsInstanceId, customerId, deletedAt: null } })
  if (!instance || !instance.vmid || !instance.proxmoxNodeId) return NextResponse.json({ error: "Server not found" }, { status: 404, headers: NO_CACHE_HEADERS })

  try {
    const operationId = randomUUID()
    runOperationBackground({
      operationId,
      kind: "snapshot",
      vpsInstanceId: instance.id,
      customerId,
      vmId: Number(instance.vmid),
      headline: `Deleting snapshot "${name}"`,
      run: async (report) => {
        report({ phase: "Deleting snapshot", status: "running" as const })
        const result = await deleteVmSnapshot({ nodeId: instance.proxmoxNodeId!, vmid: Number(instance.vmid), name, actor: "client" })
        report({ phase: "Snapshot deleted", status: "completed" as const, result: result as Record<string, unknown> })
      },
    })
    return NextResponse.json({ success: true, deleted: { queued: true }, operationId }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Deletion failed" }, { status: error?.status || 500, headers: NO_CACHE_HEADERS })
  }
}