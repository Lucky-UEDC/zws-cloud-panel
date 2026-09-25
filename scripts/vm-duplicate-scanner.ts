import "dotenv/config"
import { prisma } from "@/lib/db"
import { scanDuplicateManagedVms } from "@/lib/vm-duplicate-quarantine"

const once = process.argv.includes("--once")
const reportOnly = process.argv.includes("--report-only")
const intervalMs = Math.max(60_000, Number(process.env.VM_DUPLICATE_SCAN_INTERVAL_MS || 5 * 60_000))

async function run() {
  do {
    const result = await scanDuplicateManagedVms({ actorEmail: "system:duplicate-scanner", apply: !reportOnly })
    console.info("[DuplicateScanner]", JSON.stringify({ scanned: result.scanned, duplicateOrderCount: result.duplicateOrderCount, quarantined: result.quarantined, errors: result.errors }))
    if (once) break
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  } while (true)
}

run().catch((error) => {
  console.error("[DuplicateScanner] fatal", error)
  process.exitCode = 1
}).finally(async () => prisma.$disconnect().catch(() => undefined))
