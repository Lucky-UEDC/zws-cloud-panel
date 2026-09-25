import "dotenv/config"
import { prisma } from "@/lib/db"
import { processBackupBillingRecurrence } from "@/lib/billing/recurrence"

const once = process.argv.includes("--once")
const intervalMs = Number(process.env.BACKUP_BILLING_RECURRENCE_INTERVAL_MS || 5 * 60 * 1000)

async function tick() {
  const result = await processBackupBillingRecurrence({ emit: true })
  console.log("[backup-billing-recurrence] tick", result)
}

async function main() {
  console.log("[backup-billing-recurrence] started", { once, intervalMs })
  do {
    await tick().catch((error) => console.error("[backup-billing-recurrence] tick failed", { message: error?.message }))
    if (once) break
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  } while (true)
}

main()
  .catch((error) => {
    console.error("[backup-billing-recurrence] fatal", error)
    process.exitCode = 1
  })
  .finally(async () => {
    if (once) await prisma.$disconnect?.().catch(() => undefined)
    if (once) process.exit(process.exitCode || 0)
  })