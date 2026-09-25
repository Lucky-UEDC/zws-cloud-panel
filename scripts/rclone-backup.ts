import { createBackup } from "@/lib/backups"

const scopeArg = process.argv.find((arg) => arg.startsWith("--scope="))?.slice("--scope=".length)
const scope = scopeArg ? scopeArg.split(",").map((item) => item.trim()).filter(Boolean) : undefined

const run = await createBackup({
  triggerType: process.env.BACKUP_TRIGGER || "scheduled",
  createdBy: process.env.BACKUP_ACTOR || "system",
  scope,
})

console.log(JSON.stringify({
  id: run.id,
  status: run.status,
  localPath: run.localPath,
  remotePath: run.remotePath,
  error: run.error,
}, null, 2))

process.exit(run.status === "completed" ? 0 : 1)
