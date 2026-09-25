import "dotenv/config"
import { prisma } from "@/lib/db"
import { runPlatformHealthRepair } from "@/lib/platform-health-repair"

const once = process.argv.includes("--once")
const intervalMs = Math.max(60_000, Number(process.env.PLATFORM_HEALTH_REPAIR_INTERVAL_MS || 15 * 60 * 1000))
let stopping = false

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function tick() {
  const result = await runPlatformHealthRepair({ auto: true, limit: Number(process.env.PLATFORM_HEALTH_REPAIR_LIMIT || 50) })
  console.log("[platform-health-repair] complete", {
    repaired: result.repaired,
    skipped: result.skipped,
    failed: result.failed,
    checkedAt: result.checkedAt,
  })
  if (result.failed) process.exitCode = 1
}

async function main() {
  console.log("[platform-health-repair] started", { once, intervalMs })
  do {
    await tick().catch((error) => {
      process.exitCode = 1
      console.error("[platform-health-repair] failed", error instanceof Error ? error.message : error)
    })
    if (once) break
    await sleep(intervalMs)
  } while (!stopping)
}

process.on("SIGINT", () => { stopping = true })
process.on("SIGTERM", () => { stopping = true })

main().finally(async () => {
  await prisma.$disconnect().catch(() => undefined)
})
