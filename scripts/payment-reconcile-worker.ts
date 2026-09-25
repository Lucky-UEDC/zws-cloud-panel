import "dotenv/config"
import { prisma } from "@/lib/db"
import { repairStuckCashfreePayments } from "@/lib/payment-repair"

const once = process.argv.includes("--once")
const intervalMs = Math.max(60000, Number(process.env.PAYMENT_RECONCILE_INTERVAL_MS || 60000))
const limit = Math.max(10, Math.min(Number(process.env.PAYMENT_RECONCILE_LIMIT || 150), 500))

async function tick() {
  try {
    const result = await repairStuckCashfreePayments({
      actor: "worker:payment-reconcile",
      limit,
      dryRun: false,
    })
    const didWork = (result.repaired?.length || 0) > 0
    console.log("[PaymentReconcileWorker] tick", {
      scanned: result.scanned,
      repaired: result.repaired?.length || 0,
      skipped: result.skipped?.length || 0,
    })
    return didWork
  } catch (error: any) {
    console.error("[PaymentReconcileWorker] tick failed", { message: error?.message })
    return true
  }
}

async function main() {
  console.log("[PaymentReconcileWorker] started", { once, intervalMs, limit })
  do {
    const didWork = await tick()
    if (once) break
    await new Promise((resolve) => setTimeout(resolve, didWork ? 5000 : intervalMs))
  } while (true)
}

main().catch((error) => {
  console.error("[PaymentReconcileWorker] fatal", error)
  process.exitCode = 1
}).finally(async () => {
  await prisma.$disconnect?.().catch(() => undefined)
})
