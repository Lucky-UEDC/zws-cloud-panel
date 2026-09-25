import { repairPaidGatewayPayments } from "../lib/payment-repair"

const limitArg = process.argv.find((arg) => arg.startsWith("--limit="))
const dryRun = process.argv.includes("--dry-run")
const limit = limitArg ? Number(limitArg.split("=")[1]) : 50

async function main() {
  const result = await repairPaidGatewayPayments({
    actor: "script:reconcile-payments",
    limit,
    dryRun,
  })

  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error("[reconcile-payments] failed", error)
  process.exitCode = 1
})
