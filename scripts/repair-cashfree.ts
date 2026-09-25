import "dotenv/config"
import { prisma } from "@/lib/db"
import { repairPaidGatewayPayments, repairStuckCashfreePayments } from "@/lib/payment-repair"

const limitArg = process.argv.find((arg) => arg.startsWith("--limit="))
const dryRun = process.argv.includes("--dry-run")
const limit = limitArg ? Number(limitArg.split("=")[1]) : 200

async function main() {
  const stuck = await repairStuckCashfreePayments({
    actor: "script:repair-cashfree",
    limit,
    dryRun,
  })
  const paidRepair = await repairPaidGatewayPayments({
    actor: "script:repair-cashfree",
    limit,
    dryRun,
  })

  console.log(JSON.stringify({
    repair: "cashfree",
    dryRun,
    stuck,
    paidRepair,
  }, null, 2))
}

main().catch((error) => {
  console.error("[repair-cashfree] failed", error)
  process.exitCode = 1
}).finally(async () => {
  await prisma.$disconnect?.().catch(() => undefined)
})

