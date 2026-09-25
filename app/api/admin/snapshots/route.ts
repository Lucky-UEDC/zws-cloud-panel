import { NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { listSnapshotsForVm, listSnapshotVmCandidates, createVmSnapshot, deleteVmSnapshot, rollbackVmSnapshot, recordSnapshotFailure, getVmStorageCapability } from "@/lib/proxmox-snapshots"
import type { NextRequest } from "next/server"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

async function requireAdmin() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS }) }
  }
  return { admin }
}

function vmParams(url: URL) {
  const nodeId = url.searchParams.get("nodeId")
  const vmidRaw = url.searchParams.get("vmid")
  if (!nodeId || !vmidRaw) throw Object.assign(new Error("nodeId and vmid are required"), { status: 400 })
  return { nodeId, vmid: Number(vmidRaw) }
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error

  const url = new URL(request.url)
  try {
    if (url.searchParams.get("vms") === "1") {
      const candidates = await listSnapshotVmCandidates()
      return NextResponse.json({ vms: candidates }, { headers: NO_CACHE_HEADERS })
    }

    if (url.searchParams.get("diagnostics") === "1") {
      const { nodeId, vmid } = vmParams(url)
      const diagnostic = await getVmStorageCapability(nodeId, vmid)
      return NextResponse.json({ diagnostic }, { headers: NO_CACHE_HEADERS })
    }

    const { nodeId, vmid } = vmParams(url)
    const snapshots = await listSnapshotsForVm(nodeId, vmid)
    return NextResponse.json({ snapshots }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed" }, { status: error?.status || 500, headers: NO_CACHE_HEADERS })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error

  const url = new URL(request.url)
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: NO_CACHE_HEADERS })
  }

  const nodeId = String(body.nodeId || "")
  const vmid = Number(body.vmid)
  const name = String(body.name || "").trim()
  if (!nodeId || !Number.isInteger(vmid) || vmid <= 0 || !name) {
    return NextResponse.json({ error: "nodeId, vmid and name are required" }, { status: 400, headers: NO_CACHE_HEADERS })
  }

  const isRollback = url.searchParams.get("action") === "rollback"
  if (isRollback) {
    try {
      const result = await rollbackVmSnapshot({ nodeId, vmid, name, actor: auth.admin.email })
      return NextResponse.json({ result }, { headers: NO_CACHE_HEADERS })
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || "Rollback failed" }, { status: error?.status || 500, headers: NO_CACHE_HEADERS })
    }
  }

  try {
    const result = await createVmSnapshot({
      nodeId,
      vmid,
      name,
      description: typeof body.description === "string" ? body.description : undefined,
      vmstate: body.vmstate === true,
      actor: auth.admin.email,
    })
    return NextResponse.json({ result }, { status: 201, headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    await recordSnapshotFailure({ nodeId, vmid, name, error: error?.message || "unknown", actor: auth.admin.email })
    return NextResponse.json({ error: error?.message || "Create failed" }, { status: error?.status || 500, headers: NO_CACHE_HEADERS })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error

  const url = new URL(request.url)
  const nodeId = url.searchParams.get("nodeId")
  const vmidRaw = url.searchParams.get("vmid")
  const name = url.searchParams.get("name")
  if (!nodeId || !vmidRaw || !name) {
    return NextResponse.json({ error: "nodeId, vmid and name are required" }, { status: 400, headers: NO_CACHE_HEADERS })
  }

  try {
    const result = await deleteVmSnapshot({ nodeId, vmid: Number(vmidRaw), name, actor: auth.admin.email })
    return NextResponse.json({ result }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Delete failed" }, { status: error?.status || 500, headers: NO_CACHE_HEADERS })
  }
}