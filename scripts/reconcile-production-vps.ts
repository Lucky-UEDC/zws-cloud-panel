import "dotenv/config"
import { prisma } from "@/lib/db"
import { runProductionVpsReconciliation } from "@/lib/production-vps-reconciliation"
import { getRedisClient } from "@/lib/redis"

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function parseArgs(argv: string[]) {
  const parsed: {
    mode: "dry-run" | "apply"
    reportPath: string
    limit: number | null
    vpsId: string | null
  } = {
    mode: "dry-run",
    reportPath: `deployment-reports/production-vps-reconciliation-${timestamp()}/report.json`,
    limit: null,
    vpsId: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--dry-run") parsed.mode = "dry-run"
    else if (arg === "--apply") parsed.mode = "apply"
    else if (arg === "--report") parsed.reportPath = argv[++index] || parsed.reportPath
    else if (arg.startsWith("--report=")) parsed.reportPath = arg.slice("--report=".length)
    else if (arg === "--limit") parsed.limit = Number(argv[++index] || 0) || null
    else if (arg.startsWith("--limit=")) parsed.limit = Number(arg.slice("--limit=".length)) || null
    else if (arg === "--vps-id") parsed.vpsId = argv[++index] || null
    else if (arg.startsWith("--vps-id=")) parsed.vpsId = arg.slice("--vps-id=".length) || null
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: tsx scripts/reconcile-production-vps.ts [--dry-run|--apply] [--report <path>] [--limit <n>] [--vps-id <id-or-order-id>]")
      process.exit(0)
    }
  }
  return parsed
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const report = await runProductionVpsReconciliation({
    mode: args.mode,
    reportPath: args.reportPath,
    limit: args.limit,
    vpsId: args.vpsId,
    actor: "script:reconcile-production-vps",
  })
  console.log(JSON.stringify({
    reportPath: args.reportPath,
    mode: report.mode,
    scanned: report.scanned,
    repaired: report.repaired,
    ipsRepaired: report.ipsRepaired,
    monitoringRepaired: report.monitoringRepaired,
    diskRepaired: report.diskRepaired,
    networkRepaired: report.networkRepaired,
    activityErrorsCleared: report.activityErrorsCleared,
    missingVmsMarked: report.missingVmsMarked,
    vmsReconstructed: report.vmsReconstructed,
    ordersRepaired: report.ordersRepaired,
    customersRepaired: report.customersRepaired,
    billingRepaired: report.billingRepaired,
    dnsRepaired: report.dnsRepaired,
    provisioningIdentitiesRepaired: report.provisioningIdentitiesRepaired,
    duplicateVmsFound: report.duplicateVmsFound,
    duplicateIpsFound: report.duplicateIpsFound,
    inventoryScanned: report.inventoryScanned,
    orphanVmsQuarantined: report.orphanVmsQuarantined,
    identityMappingsRepaired: report.identityMappingsRepaired,
    remainingFailures: report.remainingFailures.length,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
    await getRedisClient()?.quit().catch(() => undefined)
  })
