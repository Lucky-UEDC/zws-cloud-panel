import "dotenv/config"
import { prisma } from "@/lib/db"
import { repairManualPaidInvoices } from "@/lib/payment-repair"

const limitArg = process.argv.find((arg) => arg.startsWith("--limit="))
const dryRun = process.argv.includes("--dry-run")
const limit = limitArg ? Number(limitArg.split("=")[1]) : 200

async function main() {
  const result = await repairManualPaidInvoices({
    actor: "script:repair-manual-paid",
    limit,
    dryRun,
  })

  const summary = {
    repair: "manual-paid",
    dryRun,
    scanned: result.scanned,
    repaired: result.repaired.length,
    skipped: result.skipped.length,
    errors: result.errors.length,
  }

  console.log("[repair:manual-paid] summary", summary)
  console.log(JSON.stringify({ ...summary, result }, null, 2))
}

main().catch((error) => {
  console.error("[repair:manual-paid] failed", error)
  process.exitCode = 1
}).finally(async () => {
  await prisma.$disconnect?.().catch(() => undefined)
})
