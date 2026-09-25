import { prisma } from "@/lib/db"

const KEY = "provision_worker_status"

export type ProvisionWorkerStatus = {
  workerId: string
  pid: number
  startedAt: string
  heartbeatAt: string
  intervalMs: number
  processed: number
  errors: number
  lastResult?: unknown
  lastError?: string | null
}

function asStatus(value: unknown): ProvisionWorkerStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const row = value as Record<string, any>
  if (!row.workerId || !row.heartbeatAt) return null
  return row as ProvisionWorkerStatus
}

export async function writeProvisionWorkerHeartbeat(status: ProvisionWorkerStatus) {
  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: {
      key: KEY,
      group: "runtime",
      value: status as any,
      updatedBy: status.workerId,
    },
    update: {
      value: status as any,
      updatedBy: status.workerId,
    },
  })
}

export async function readProvisionWorkerHeartbeat() {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } }).catch(() => null)
  const status = asStatus(row?.value)
  if (!status) return null
  const heartbeatMs = Date.parse(status.heartbeatAt)
  const ageMs = Number.isFinite(heartbeatMs) ? Date.now() - heartbeatMs : null
  return {
    ...status,
    ageMs,
    healthy: ageMs !== null && ageMs < Math.max(30000, Number(status.intervalMs || 5000) * 4),
    dbUpdatedAt: row?.updatedAt?.toISOString?.() || null,
  }
}
