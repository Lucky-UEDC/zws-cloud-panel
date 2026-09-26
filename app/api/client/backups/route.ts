import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { computeBackupUsageSummary, resolveBackupEntitlement, entitlementToJson } from "@/lib/billing/entitlements"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

const DONE_STATUSES = ["completed", "failed", "cancelled"]

/** Customer-facing friendly label for a server (never an internal infra id). */
function friendlyServerName(instance: any, fallback: string) {
  const candidate = instance?.displayTag || instance?.instanceName || instance?.name || instance?.hostname || ""
  const label = String(candidate || "").trim() || fallback
  // Prefer the customer's Server Tag when present; otherwise the canonical IP hostname.
  if (instance?.displayTag) return String(instance.displayTag).trim()
  if (/^ip-\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}$/.test(label)) return label
  return label
}

function normalizeBackupRow(row: any, instancesById: Map<string, any>) {
  const instance = instancesById.get(String(row.vpsInstanceId))
  const metadata = (row.metadata as Record<string, unknown>) || {}
  return {
    id: row.id,
    vmId: row.vmid,
    name: friendlyServerName(instance, `VM-${row.vmid}`),
    ipAddress: instance?.ipAddress || null,
    vpsInstanceId: row.vpsInstanceId,
    status: row.status,
    sizeBytes: row.sizeBytes != null ? String(row.sizeBytes) : null,
    // The internal storage artifact name (volid/path) is NOT exposed to clients.
    fileName: null,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    error: row.status !== "completed" && row.status !== "cancelled" ? (metadata.error || null) : null,
  }
}

export async function GET(request: NextRequest) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })

  const url = new URL(request.url)
  const vmIdParam = url.searchParams.get("vmId") || url.searchParams.get("vmid")
  const vpsInstanceIdParam = url.searchParams.get("vpsInstanceId")
  const statusParam = url.searchParams.get("status")
  const fromParam = url.searchParams.get("from")
  const toParam = url.searchParams.get("to")
  const searchParam = (url.searchParams.get("search") || "").trim().toLowerCase()
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 500), 1), 500)

  const instances = await prisma.vpsInstance.findMany({
    where: { customerId, deletedAt: null, vmid: { gt: 0 } },
    select: { id: true, vmid: true, name: true, instanceName: true, hostname: true, displayTag: true, ipAddress: true, status: true },
    orderBy: { vmid: "asc" },
  })
  const instanceIds = instances.map((i) => i.id)
  const entitlementResult = await resolveBackupEntitlement(customerId)
  const usageSummary = instanceIds.length === 0
    ? { entitled: false, entitleed: false, storageQuotaGb: 0, storageQuotaBytes: 0n, usedGb: 0, usedBytes: 0n, backupCount: 0, overStorage: false, overageGb: 0, overStoragePercent: 0, capReached: false, maxBackups: null, backupsRemaining: 0, planName: null, planId: null, subscriptionId: null, status: "none", overageEnabled: false, overageRatePerGb: 0, backups: [] as any[] }
    : await computeBackupUsageSummary(customerId, { entitlement: entitlementResult.entitlement })
  if (instanceIds.length === 0) return NextResponse.json({ success: true, vms: [], backups: [], filters: { vmId: null }, billing: { entitlement: entitlementToJson(entitlementResult.entitlement), usage: normalizeUsageJson(usageSummary), subscribed: Boolean(entitlementResult.entitlement?.subscriptionId) } }, { headers: NO_CACHE_HEADERS })

  const backupWhere: Record<string, unknown> = {
    vpsInstanceId: { in: instanceIds },
    ...(vpsInstanceIdParam
      ? { vpsInstanceId: String(vpsInstanceIdParam) }
      : {}),
    ...(vmIdParam
      ? { vmid: Number(vmIdParam) }
      : {}),
    ...(statusParam
      ? { status: statusParam }
      : { status: { in: DONE_STATUSES } }),
  }
  if (fromParam || toParam) {
    backupWhere.startedAt = {
      ...(fromParam ? { gte: new Date(fromParam) } : {}),
      ...(toParam ? { lte: new Date(toParam) } : {}),
    }
  }

  const backups = await prisma.vmBackup.findMany({
    where: backupWhere as any,
    orderBy: { createdAt: "desc" },
    take: limit,
  })
  const instancesById = new Map(instances.map((i) => [i.id, i]))
  let rows = backups.map((row) => normalizeBackupRow(row, instancesById))
  if (searchParam) {
    rows = rows.filter((row) => String(row.name || "").toLowerCase().includes(searchParam) || String(row.id || "").toLowerCase().includes(searchParam))
  }

  const vms = instances.map((i) => {
    const label = friendlyServerName(i, `VM-${i.vmid}`)
    return {
      vmId: Number(i.vmid),
      vpsInstanceId: i.id,
      name: label,
      label: i.ipAddress ? `${label} — ${i.ipAddress}` : label,
      status: i.status,
    }
  })

  return NextResponse.json(
    {
      success: true,
      vms,
      backups: rows,
      filters: { vmId: vmIdParam || null, status: statusParam || null },
      billing: {
        entitlement: entitlementToJson(entitlementResult.entitlement),
        usage: normalizeUsageJson(usageSummary),
        subscribed: Boolean(entitlementResult.entitlement?.subscriptionId),
      },
    },
    { headers: NO_CACHE_HEADERS },
  )
}

function normalizeUsageJson(usage: Record<string, any>) {
  const { backups: _backups, ...rest } = usage
  // Quota/usage fields are Prisma BigInt-backed (usedBytes, storageQuotaBytes,
  // remainingBytes, …). Everything must be JSON-safe before NextResponse.json —
  // otherwise the route dies with "Do not know how to serialize a BigInt".
  // The `backups` array of raw rows is deliberately dropped; the response ships
  // the client-safe `rows` instead.
  return JSON.parse(JSON.stringify(rest, (_key, value) => (typeof value === "bigint" ? String(value) : value)))
}