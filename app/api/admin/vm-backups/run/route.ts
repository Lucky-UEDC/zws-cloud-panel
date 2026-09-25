import { NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { prisma } from "@/lib/db"
import { runVmBackupTask, sanitizeBackupRequest } from "@/lib/proxmox-backup"

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

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: NO_CACHE_HEADERS })
  }

  const { request: parsed, error: parseError, dropped } = sanitizeBackupRequest(body)
  if (!parsed) {
    return NextResponse.json({ error: parseError || "Invalid backup request payload" }, { status: 400, headers: NO_CACHE_HEADERS })
  }
  if (dropped.length > 0) {
    console.warn("[vm-backups] run request contained unsupported fields", { dropped, policyId: parsed.policyId })
  }

  const policyId = parsed.policyId
  if (!policyId) return NextResponse.json({ error: "policyId is required" }, { status: 400, headers: NO_CACHE_HEADERS })

  const policy = await prisma.vmBackupPolicy.findUnique({ where: { id: policyId } })
  if (!policy) return NextResponse.json({ error: "Policy not found" }, { status: 404, headers: NO_CACHE_HEADERS })

  const vmids = Array.isArray(policy.includeVms) ? policy.includeVms.map((v) => Number(v)) : []
  const requestedVmid = parsed.vmid != null ? Number(parsed.vmid) : null
  const targets = requestedVmid ? [requestedVmid] : vmids
  if (targets.length === 0) {
    return NextResponse.json({ error: "Policy has no VMs" }, { status: 400, headers: NO_CACHE_HEADERS })
  }

  const actor = auth.admin.email || "admin"

  if (policy.isEnabled && !targets.some((v) => vmids.includes(v))) {
    await prisma.vmBackupPolicy.update({ where: { id: policy.id }, data: { includeVms: [...new Set([...vmids, ...targets])] } })
  }

  if (parsed.sync === true) {
    const results: Record<number, string> = {}
    for (const vmid of targets) {
      const result = await runVmBackupTask({ policyId: policy.id, vmid, actor })
      results[vmid] = result?.status || "failed"
    }
    const failures = Object.values(results).filter((status) => status !== "completed").length
    await prisma.vmBackupPolicy.update({
      where: { id: policy.id },
      data: { lastRunAt: new Date(), lastStatus: failures === 0 ? "success" : "partial", lastError: failures === 0 ? null : "Some VMs failed", nextRunAt: new Date(Date.now() + Math.max(1, policy.scheduleMinutes) * 60 * 1000) },
    })
    return NextResponse.json({ accepted: true, sync: true, results }, { headers: NO_CACHE_HEADERS })
  }

  await prisma.vmBackupPolicy.update({
    where: { id: policy.id },
    data: { nextRunAt: new Date(Date.now() + 30 * 1000) },
  })

  return NextResponse.json(
    { accepted: true, sync: false, scheduledFor: new Date(Date.now() + 30 * 1000).toISOString(), message: "Backup queued; scheduler will pick it up within a minute" },
    { headers: NO_CACHE_HEADERS },
  )
}