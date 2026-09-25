import { prisma } from "@/lib/db"
import { backupStorageUsed } from "@/lib/backups"
import { getServiceIntegrationConfig } from "@/lib/integration-config"
import { googleDriveBackupHealth } from "@/lib/google-drive-backup"

export async function backupHealth() {
  const [config, drive, lastRun, storageUsedBytes] = await Promise.all([
    getServiceIntegrationConfig("backups").catch(() => ({} as Record<string, unknown>)),
    googleDriveBackupHealth().catch(() => null),
    (prisma as any).backupRun.findFirst({ orderBy: { createdAt: "desc" } }).catch(() => null),
    backupStorageUsed().catch(() => 0),
  ])
  const provider = String(drive?.enabled ? "google_drive" : config.provider || "local").toLowerCase()
  const remote = String(config.remote || config.rcloneRemote || "")
  const retentionDays = Math.max(1, Number(config.retentionDays || 30) || 30)
  return {
    ok: true,
    destinationConfigured: true,
    provider,
    remoteConfigured: Boolean(remote || drive?.connected),
    googleDrive: drive,
    lastStatus: lastRun?.status || null,
    lastRunAt: lastRun?.createdAt?.toISOString?.() || null,
    storageUsedBytes,
    retentionDays,
  }
}
