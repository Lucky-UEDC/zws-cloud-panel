import "dotenv/config"
import { prisma } from "@/lib/db"
import { parseConsoleRepairArgs, printConsoleReport, runConsoleAudit } from "@/lib/proxmox-console-repair"

async function main() {
  const options = parseConsoleRepairArgs(process.argv.slice(2))
  if (!options.apply) {
    console.error("Refusing to mutate Proxmox/guest state without --apply. Use pnpm console:audit for read-only checks.")
    process.exitCode = 2
    return
  }
  const report = await runConsoleAudit(options)
  printConsoleReport(report, Boolean(options.json))
  process.exitCode = report.success ? 0 : 1
}

main()
  .catch((error) => {
    console.error(error?.message || error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
