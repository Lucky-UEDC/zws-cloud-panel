import { createBackup, ensureRuntimeBackupDestination, recoverStaleBackupRuns } from "@/lib/backups"
import { getServiceIntegrationConfig } from "@/lib/integration-config"
import { prisma } from "@/lib/db"

const INTERVALS: Record<string, number> = {
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
}

function text(value: unknown) {
  return String(value || "").trim()
}

async function schedulerConfig() {
  const [backups, drive] = await Promise.all([
    getServiceIntegrationConfig("backups").catch(() => ({} as Record<string, unknown>)),
    getServiceIntegrationConfig("googleDriveBackups").catch(() => ({} as Record<string, unknown>)),
  ])
  const localBackupsEnabled = backups.localBackupsEnabled === true || text(backups.localBackupsEnabled).toLowerCase() === "true"
  const enabled = localBackupsEnabled && (drive.enabled === true || text(drive.enabled).toLowerCase() === "true" || text(backups.provider).toLowerCase().includes("drive"))
  const interval = text(backups.scheduleInterval || backups.scheduleCron || drive.scheduleInterval || "30m")
  const intervalMs = INTERVALS[interval] || 0
  return { enabled: Boolean(enabled && intervalMs), localBackupsEnabled, interval, intervalMs, scope: backups.scope || ["database"] }
}

async function due(intervalMs: number) {
  const destination = await ensureRuntimeBackupDestination("backup-scheduler")
  const last = await (prisma as any).backupRun.findFirst({
    where: { destinationId: destination.id, triggerType: "scheduled", status: { in: ["running", "completed"] } },
    orderBy: { createdAt: "desc" },
  }).catch(() => null)
  if (!last) return true
  if (last.status === "running" && Date.now() - new Date(last.createdAt).getTime() < intervalMs) return false
  const lastAt = new Date(last.completedAt || last.createdAt).getTime()
  return Date.now() - lastAt >= intervalMs
}

async function tick() {
  await recoverStaleBackupRuns({ maxAgeMinutes: 120, actor: "backup-scheduler" }).catch(() => null)
  const config = await schedulerConfig()
  if (!config.localBackupsEnabled) return console.log("[backup-scheduler] local backups disabled")
  if (!config.enabled) return console.log("[backup-scheduler] disabled")
  if (!await due(config.intervalMs)) return console.log("[backup-scheduler] not due", { interval: config.interval })
  const run = await createBackup({ createdBy: "backup-scheduler", triggerType: "scheduled", scope: config.scope })
  console.log("[backup-scheduler] run complete", { id: run.id, status: run.status })
}

async function main() {
  const once = process.argv.includes("--once")
  await tick().catch((error) => {
    console.error("[backup-scheduler] tick failed", error)
    process.exitCode = 1
  })
  if (once) {
    await prisma.$disconnect().catch(() => undefined)
    process.exit(process.exitCode || 0)
  }
  setInterval(() => tick().catch((error) => console.error("[backup-scheduler] tick failed", error)), 60 * 1000)
}

main()
