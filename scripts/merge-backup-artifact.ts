import { prisma } from "@/lib/db"
import { registerLocalBackupArtifact, restoreBackup } from "@/lib/backups"

type Mode = "DRY_RUN" | "MERGE_RESTORE"

function argValue(name: string) {
  const prefix = `--${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(`--${name}`)
  if (index >= 0) return process.argv[index + 1]
  return undefined
}

function usage(message?: string): never {
  if (message) console.error(message)
  console.error("Usage: pnpm backup:merge -- --file=/path/backup.sql.gz --mode=dry-run|merge [--tables=a,b] [--created-by=email] [--confirm='MERGE RESTORE']")
  process.exit(2)
}

function modeFromArg(value: string | undefined): Mode {
  const normalized = String(value || "dry-run").toLowerCase()
  if (normalized === "dry-run" || normalized === "dry_run" || normalized === "dryrun") return "DRY_RUN"
  if (normalized === "merge" || normalized === "merge-restore" || normalized === "merge_restore") return "MERGE_RESTORE"
  usage(`Unsupported mode: ${value}`)
}

async function main() {
  const filePath = argValue("file") || process.env.BACKUP_ARTIFACT
  if (!filePath) usage("Missing --file or BACKUP_ARTIFACT.")

  const mode = modeFromArg(argValue("mode") || process.env.BACKUP_MERGE_MODE)
  const confirmation = argValue("confirm") || process.env.BACKUP_MERGE_CONFIRMATION || (mode === "MERGE_RESTORE" ? "MERGE RESTORE" : "DRY RUN")
  const createdBy = argValue("created-by") || process.env.BACKUP_MERGE_CREATED_BY || "aws-clone-deployment"
  const tables = (argValue("tables") || process.env.BACKUP_MERGE_TABLES || "")
    .split(",")
    .map((table) => table.trim())
    .filter(Boolean)

  if (mode === "MERGE_RESTORE" && confirmation !== "MERGE RESTORE") {
    usage("Merge restore requires --confirm='MERGE RESTORE'.")
  }

  const backupRun = await registerLocalBackupArtifact({ filePath, createdBy })
  const restore = await restoreBackup({
    backupRunId: backupRun.id,
    mode,
    confirmation,
    tables,
    createdBy,
  })

  const result = {
    backupRunId: backupRun.id,
    restoreTestId: restore.id,
    status: restore.status,
    testedAt: restore.testedAt,
    error: restore.error,
    log: restore.log,
  }
  console.log(JSON.stringify(result, null, 2))
  if (restore.status !== "passed") process.exit(1)
}

main()
  .catch((error) => {
    console.error(error?.stack || error?.message || String(error))
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
