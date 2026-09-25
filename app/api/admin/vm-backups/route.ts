import { NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { prisma } from "@/lib/db"
import { discoverBackupStorages, getPrimaryMonitoringNodeId, listBackupHistory } from "@/lib/proxmox-backup"

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

function parseVmIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const ids: number[] = []
  for (const entry of value) {
    const n = Number(entry)
    if (Number.isInteger(n) && n > 0 && !ids.includes(n)) ids.push(n)
  }
  return ids
}

function parsePolicyInput(body: Record<string, unknown>) {
  const storage = String(body.storage || "").trim()
  if (!storage) throw new Error("Backup storage is required")
  const retention = Math.max(1, Math.min(30, Number(body.retention) || 5))
  const scheduleMinutes = Math.max(5, Math.min(1440 * 7, Number(body.scheduleMinutes) || 60))
  const mode = ["snapshot", "suspend", "stop"].includes(String(body.mode)) ? String(body.mode) : "snapshot"
  const compress = ["zstd", "lzo", "gzip", "gzipfast", "gziprd"].includes(String(body.compress)) ? String(body.compress) : null
  const notify = ["disabled", "always", "failure"].includes(String(body.notify)) ? String(body.notify) : "disabled"
  return {
    name: String(body.name || "").trim() || `VM Backup ${new Date().toISOString().slice(0, 10)}`,
    nodeId: typeof body.nodeId === "string" && body.nodeId ? body.nodeId : null,
    storage,
    retention,
    scheduleMinutes,
    includeVms: parseVmIds(body.includeVms),
    mode,
    compress,
    notify,
    isEnabled: body.isEnabled !== false,
  }
}

export async function GET() {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error

  const [monitoredNodeId, policies, history] = await Promise.all([
    getPrimaryMonitoringNodeId(),
    prisma.vmBackupPolicy.findMany({ orderBy: { updatedAt: "desc" } }),
    listBackupHistory(undefined, undefined, 50),
  ])

  let storages: unknown[] = []
  let primaryNodeId: string | null = monitoredNodeId
  if (monitoredNodeId) {
    try {
      storages = await discoverBackupStorages(monitoredNodeId)
      primaryNodeId = monitoredNodeId
    } catch (error: any) {
      const fallback = await prisma.proxmoxNode.findFirst({ where: { isActive: true } })
      if (fallback) {
        try {
          storages = await discoverBackupStorages(fallback.id)
          primaryNodeId = fallback.id
        } catch {
          storages = []
        }
      }
    }
  }

  return NextResponse.json({ primaryNodeId, storages, policies, history }, { headers: NO_CACHE_HEADERS })
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: NO_CACHE_HEADERS })
  }

  try {
    const input = parsePolicyInput(body)
    const policy = await prisma.vmBackupPolicy.create({
      data: { ...input, createdBy: auth.admin.email, nextRunAt: new Date(Date.now() + Math.max(1, input.scheduleMinutes) * 60 * 1000) },
    })
    return NextResponse.json({ policy }, { status: 201, headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to create policy" }, { status: 400, headers: NO_CACHE_HEADERS })
  }
}