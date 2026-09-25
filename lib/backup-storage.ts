export type BackupStorageInfo = {
  name: string
  type: string
  content: string
  supportsBackup: boolean
  totalBytes: number
  usedBytes: number
  availBytes: number
  enabled: boolean
}

export const BACKUP_SCHEDULE_PRESETS = [
  { value: 30, label: "Every 30 minutes" },
  { value: 60, label: "Every 1 hour" },
  { value: 180, label: "Every 3 hours" },
  { value: 360, label: "Every 6 hours" },
  { value: 720, label: "Every 12 hours" },
  { value: 1440, label: "Every 24 hours" },
] as const

export const BACKUP_RETENTION_PRESETS = [
  { value: 1, label: "Keep last 1" },
  { value: 3, label: "Keep last 3" },
  { value: 5, label: "Keep last 5" },
  { value: 7, label: "Keep last 7" },
  { value: 10, label: "Keep last 10" },
  { value: 0, label: "Keep all" },
] as const

const LOCAL_ONLY_STORAGE = /^(local|local-lvm|rootfs|rpool\d*)$/i

export function preferredBackupStorage(storages: BackupStorageInfo[]): string {
  const usable = storages.filter((storage) => storage.supportsBackup && storage.enabled && storage.availBytes > 0)
  if (!usable.length) return storages.find((storage) => storage.supportsBackup)?.name || ""
  const preferred = usable.filter((storage) => !LOCAL_ONLY_STORAGE.test(storage.name))
  if (preferred.length) return preferred[0].name
  return usable[0].name
}