import "dotenv/config"
import { prisma } from "@/lib/db"
import { processVmDeletionJob } from "@/lib/vm-deletion"

const once = process.argv.includes("--once")
const intervalMs = Number(process.env.VM_DELETION_WORKER_INTERVAL_MS || 60_000)
let stopping = false

function deletionModel() {
  return (prisma as any).vmDeletionJob
}

async function runCycle() {
  const jobs = await deletionModel().findMany({
    where: {
      status: { in: ["delete_requested", "delete_pending"] },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
    },
    orderBy: [{ nextRetryAt: "asc" }, { createdAt: "asc" }],
    take: Number(process.env.VM_DELETION_WORKER_BATCH_SIZE || 5),
  })

  for (const job of jobs) {
    try {
      const result = await processVmDeletionJob(job.id, "system")
      console.log("[vm-deletion-worker] processed", { jobId: job.id, status: result.status })
    } catch (error: any) {
      console.error("[vm-deletion-worker] failed", { jobId: job.id, error: error?.message || String(error) })
    }
  }
}

async function main() {
  do {
    await runCycle()
    if (once) break
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  } while (!stopping)
  await prisma.$disconnect().catch(() => undefined)
}

process.on("SIGINT", () => { stopping = true })
process.on("SIGTERM", () => { stopping = true })

main().catch(async (error) => {
  console.error("[vm-deletion-worker] fatal", error)
  await prisma.$disconnect().catch(() => undefined)
  process.exit(1)
})
