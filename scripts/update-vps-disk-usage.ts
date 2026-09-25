import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { prisma } from "@/lib/db"

const execFileAsync = promisify(execFile)
const CONCURRENCY = Number(process.env.ZWS_DISK_USAGE_CONCURRENCY || 2)

// Cron example:
// */5 * * * * cd /var/www/zws && pnpm tsx scripts/update-vps-disk-usage.ts >> /var/log/zws-disk-usage.log 2>&1

type DiskUsage = {
  usedGb: number
  totalGb: number
  percent: number
}

function finiteNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseDiskUsage(output: string): DiskUsage {
  const trimmed = output.trim()
  if (!trimmed) throw new Error("zwsdisk returned empty output")

  try {
    const data = JSON.parse(trimmed)
    const usedGb = finiteNumber(data.usedGb ?? data.used_gb ?? data.used)
    const totalGb = finiteNumber(data.totalGb ?? data.total_gb ?? data.total)
    const percent = finiteNumber(data.percent ?? data.usagePercent ?? data.usage_percent)
    if (usedGb !== null && totalGb !== null && percent !== null) return { usedGb, totalGb, percent }
  } catch {
    // Fall through to text parsing.
  }

  const usedGb = finiteNumber(trimmed.match(/used(?:\s*gb)?\s*[:=]\s*([0-9.]+)/i)?.[1])
  const totalGb = finiteNumber(trimmed.match(/total(?:\s*gb)?\s*[:=]\s*([0-9.]+)/i)?.[1])
  const percent = finiteNumber(trimmed.match(/(?:percent|usage)\s*[:=]\s*([0-9.]+)%?/i)?.[1])
  if (usedGb === null || totalGb === null || percent === null) throw new Error("Unable to parse zwsdisk output")
  return { usedGb, totalGb, percent }
}

async function updateOne(vps: { id: string; vmid: number }) {
  const { stdout } = await execFileAsync("zwsdisk", [String(vps.vmid)], { timeout: 30_000, maxBuffer: 1024 * 64 })
  const usage = parseDiskUsage(stdout)
  await prisma.vpsInstance.update({
    where: { id: vps.id },
    data: {
      diskUsedGb: usage.usedGb,
      diskTotalGb: usage.totalGb,
      diskUsagePercent: Math.max(0, Math.min(100, usage.percent)),
      diskUsageCheckedAt: new Date(),
      diskUsageSource: "zwsdisk",
    },
  })
  console.log(`[disk-usage] updated vps=${vps.id} vmid=${vps.vmid} used=${usage.usedGb}GB total=${usage.totalGb}GB percent=${usage.percent}`)
}

async function main() {
  const vpsList = await prisma.vpsInstance.findMany({
    where: {
      deletedAt: null,
      suspendedAt: null,
      status: { notIn: ["DELETED", "deleted", "stopped", "STOPPED", "suspended", "SUSPENDED"] },
      vmid: { gt: 0 },
      order: { deletedAt: null, status: { notIn: ["DELETED", "deleted", "cancelled", "refunded"] } },
    },
    select: { id: true, vmid: true },
    orderBy: { updatedAt: "asc" },
  })

  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(3, CONCURRENCY)) }, async () => {
    while (cursor < vpsList.length) {
      const vps = vpsList[cursor++]
      try {
        await updateOne(vps)
      } catch (error: any) {
        console.error(`[disk-usage] failed vps=${vps.id} vmid=${vps.vmid}: ${error?.message || error}`)
      }
    }
  })
  await Promise.all(workers)
}

main()
  .catch((error) => {
    console.error("[disk-usage] fatal", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
