import "dotenv/config"
import { prisma } from "@/lib/db"

const REPLACEMENTS = [
  ["Template cloning", "Installing Ubuntu 22.04"],
  ["Cloud-init configuring", "Configuring server settings"],
  ["Network attaching", "Allocating IP & network"],
  ["Boot validation", "Starting server services"],
  ["Security hardening", "Applying security protection"],
  ["Finalizing deployment", "Final server optimization"],
  ["Service ready", "Your cloud server is ready"],
  ["Applying hostname, password, IP, gateway and DNS", "Configuring server settings"],
  ["Starting VM", "Starting server services"],
  ["Verifying VM status", "Final server optimization"],
  ["VPS is running", "Your cloud server is ready"],
] as const

async function replaceInColumn(table: string, column: string, from: string, to: string) {
  return prisma.$executeRawUnsafe(`UPDATE "${table}" SET "${column}" = replace("${column}", $1, $2) WHERE "${column}" LIKE $3`, from, to, `%${from}%`)
}

async function main() {
  const results: Array<{ from: string; to: string; rows: number }> = []
  for (const [from, to] of REPLACEMENTS) {
    const counts = await Promise.all([
      replaceInColumn("provisioning_task_logs", "message", from, to),
      replaceInColumn("provisioning_jobs", "displayStatus", from, to),
      replaceInColumn("panel_logs", "message", from, to),
    ])
    results.push({ from, to, rows: counts.reduce((sum, count) => sum + Number(count || 0), 0) })
  }
  console.table(results)
}

main()
  .catch((error) => {
    console.error("[repair-provisioning-wording] failed", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => null)
  })
