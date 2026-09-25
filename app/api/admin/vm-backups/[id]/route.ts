import { NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { prisma } from "@/lib/db"
import { discoverBackupStorages } from "@/lib/proxmox-backup"

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

type RouteContext = { params: Promise<{ id: string }> }

function parseVmIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const ids: number[] = []
  for (const entry of value) {
    const n = Number(entry)
    if (Number.isInteger(n) && n > 0 && !ids.includes(n)) ids.push(n)
  }
  return ids
}

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error

  const { id } = await context.params
  const policy = await prisma.vmBackupPolicy.findUnique({ where: { id } })
  if (!policy) return NextResponse.json({ error: "Policy not found" }, { status: 404, headers: NO_CACHE_HEADERS })

  let storages: unknown[] = []
  if (policy.nodeId) {
    try {
      storages = await discoverBackupStorages(policy.nodeId)
    } catch {
      storages = []
    }
  }

  return NextResponse.json({ policy, storages }, { headers: NO_CACHE_HEADERS })
}

export async function PUT(request: Request, context: RouteContext) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error

  const { id } = await context.params
  const existing = await prisma.vmBackupPolicy.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Policy not found" }, { status: 404, headers: NO_CACHE_HEADERS })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: NO_CACHE_HEADERS })
  }

  const data: Record<string, unknown> = {}
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim()
  if (body.nodeId === null || typeof body.nodeId === "string") data.nodeId = body.nodeId || null
  if (typeof body.storage === "string" && body.storage.trim()) data.storage = body.storage.trim()
  if (body.scheduleMinutes !== undefined) data.scheduleMinutes = Math.max(5, Math.min(1440 * 7, Number(body.scheduleMinutes) || 60))
  if (body.retention !== undefined) data.retention = Math.max(1, Math.min(30, Number(body.retention) || 5))
  if (body.includeVms !== undefined) data.includeVms = parseVmIds(body.includeVms)
  if (body.mode !== undefined) data.mode = ["snapshot", "suspend", "stop"].includes(String(body.mode)) ? String(body.mode) : "snapshot"
  if (body.compress !== undefined) data.compress = ["zstd", "lzo", "gzip", "gzipfast", "gziprd"].includes(String(body.compress)) ? String(body.compress) : null
  if (body.notify !== undefined) data.notify = ["disabled", "always", "failure"].includes(String(body.notify)) ? String(body.notify) : "disabled"
  if (body.isEnabled !== undefined) data.isEnabled = body.isEnabled !== false

  try {
    const policy = await prisma.vmBackupPolicy.update({ where: { id }, data })
    return NextResponse.json({ policy }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to update policy" }, { status: 400, headers: NO_CACHE_HEADERS })
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error

  const { id } = await context.params
  const existing = await prisma.vmBackupPolicy.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Policy not found" }, { status: 404, headers: NO_CACHE_HEADERS })

  try {
    await prisma.vmBackupPolicy.delete({ where: { id } })
    return NextResponse.json({ ok: true }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to delete policy" }, { status: 400, headers: NO_CACHE_HEADERS })
  }
}