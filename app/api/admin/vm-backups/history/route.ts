import { NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { listBackupHistory } from "@/lib/proxmox-backup"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

function normalizeHistoryRows(rows: any[]) {
  return rows.map((row) => ({
    id: row.id,
    vmid: row.vmid,
    vpsInstanceId: row.vpsInstanceId,
    schedule: row.schedule,
    status: row.status,
    destination: row.destination,
    backupPath: row.backupPath,
    sizeBytes: row.sizeBytes ? String(row.sizeBytes) : null,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    metadata: row.metadata,
    vm: row.vmName ? { name: row.vmName } : null,
    customer: null,
  }))
}

export async function GET(request: Request) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const url = new URL(request.url)
  const policyId = url.searchParams.get("policyId") || undefined
  const vmidRaw = url.searchParams.get("vmid")
  const vmid = vmidRaw ? Number(vmidRaw) : undefined
  const limitRaw = url.searchParams.get("limit")
  const limit = limitRaw ? Number(limitRaw) : 200

  try {
    const rows = await listBackupHistory(policyId, vmid, limit)
    return NextResponse.json({ history: normalizeHistoryRows(rows as any[]) }, { headers: { ...NO_CACHE_HEADERS } })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500, headers: NO_CACHE_HEADERS })
  }
}