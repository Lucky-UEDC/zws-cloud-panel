import "dotenv/config"
import { prisma } from "@/lib/db"
import { claimNextVmActionJob, executeVmActionJob } from "@/lib/vm-action-jobs"
import { getRedisClient } from "@/lib/redis"

const once = process.argv.includes("--once")
let stopping = false
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function loop() {
  do {
    const job = await claimNextVmActionJob()
    if (job) await executeVmActionJob(job)
    else if (!once) await sleep(1_000)
  } while (!stopping && !once)
}

process.on("SIGTERM", () => { stopping = true })
process.on("SIGINT", () => { stopping = true })

loop().catch((error) => {
  console.error("[vm-action-worker] fatal", error)
  process.exitCode = 1
}).finally(async () => {
  await prisma.$disconnect().catch(() => undefined)
  await getRedisClient()?.quit().catch(() => undefined)
})
