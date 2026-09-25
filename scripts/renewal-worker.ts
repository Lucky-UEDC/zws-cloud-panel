import "dotenv/config"
import { prisma } from "@/lib/db"
import { processRenewalsOnce } from "@/lib/renewals"

const once = process.argv.includes("--once")
const intervalMs = Number(process.env.RENEWAL_WORKER_INTERVAL_MS || 60 * 1000)

async function tick() {
  const result = await processRenewalsOnce()
  console.log("[RenewalWorker] tick", result)
}

async function main() {
  console.log("[RenewalWorker] started", { once, intervalMs })
  do {
    await tick().catch((error) => console.error("[RenewalWorker] tick failed", { message: error?.message }))
    if (once) break
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  } while (true)
}

main()
  .catch((error) => {
    console.error("[RenewalWorker] fatal", error)
    process.exitCode = 1
  })
  .finally(async () => {
    if (once) await prisma.$disconnect?.().catch(() => undefined)
    if (once) process.exit(process.exitCode || 0)
  })
