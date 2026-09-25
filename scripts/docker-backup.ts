import "dotenv/config"
import { cleanupExpiredBackups, createBackup, registerLocalBackupArtifact, restoreBackup } from "@/lib/backups"
import { prisma } from "@/lib/db"

function argValue(name: string) {
  const prefix = `--${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || ""
}

async function main() {
  const command = process.argv[2] || "backup"
  if (command === "backup") {
    const scope = (argValue("scope") || process.env.BACKUP_SCOPE || "database").split(",").map((item) => item.trim()).filter(Boolean)
    const run = await createBackup({ createdBy: process.env.BACKUP_ACTOR || "docker-backup", triggerType: "docker", scope })
    console.log(JSON.stringify({ ok: run.status === "completed", run }, null, 2))
    if (run.status !== "completed") process.exitCode = 1
    return
  }
  if (command === "retention") {
    console.log(JSON.stringify(await cleanupExpiredBackups("docker-backup"), null, 2))
    return
  }
  if (command === "restore") {
    const file = argValue("file") || process.env.BACKUP_ARTIFACT
    const backupRunId = argValue("backup-run-id") || process.env.BACKUP_RUN_ID
    const dryRun = process.argv.includes("--dry-run") || process.env.BACKUP_RESTORE_DRY_RUN === "1"
    const mode = dryRun ? "DRY_RUN" : "MERGE_RESTORE"
    const run = backupRunId
      ? { id: backupRunId }
      : file
        ? await registerLocalBackupArtifact({ filePath: file, createdBy: "docker-backup" })
        : null
    if (!run?.id) throw new Error("restore requires --backup-run-id=<id> or --file=<path>")
    const restored = await restoreBackup({
      backupRunId: run.id,
      mode,
      confirmation: mode === "MERGE_RESTORE" ? (argValue("confirm") || process.env.BACKUP_MERGE_CONFIRMATION || "") : "DRY RUN",
      createdBy: process.env.BACKUP_ACTOR || "docker-backup",
      tables: (argValue("tables") || process.env.BACKUP_RESTORE_TABLES || "").split(",").map((table) => table.trim()).filter(Boolean),
    })
    console.log(JSON.stringify(restored, null, 2))
    return
  }
  throw new Error(`Unknown backup command: ${command}`)
}

main()
  .catch((error) => {
    console.error("[docker-backup] failed", error?.message || String(error))
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
