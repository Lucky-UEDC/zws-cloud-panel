import "dotenv/config"
import { performance } from "node:perf_hooks"
import { prisma } from "@/lib/db"

const iterations = Math.max(5, Number(process.env.DB_PERF_ITERATIONS || 20))
const thresholdMs = Math.max(1, Number(process.env.DB_CRITICAL_P95_MS || 100))

function percentile(values: number[], value: number) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)] || 0
}

const checks = [
  {
    name: "customer_search",
    run: () => prisma.customer.findMany({ where: { OR: [{ email: { contains: "test", mode: "insensitive" } }, { name: { contains: "test", mode: "insensitive" } }, { phone: { contains: "test" } }, { phoneNumber: { contains: "test" } }] }, select: { id: true, email: true, name: true, phone: true, phoneNumber: true }, take: 50 }),
  },
  {
    name: "customer_vm_dashboard",
    run: () => prisma.vpsInstance.findMany({ where: { deletedAt: null }, select: { id: true, customerId: true, orderId: true, proxmoxNodeId: true, vmid: true, status: true, ipAddress: true }, orderBy: { updatedAt: "desc" }, take: 50 }),
  },
  {
    name: "provisioning_queue",
    run: () => prisma.provisioningJob.findMany({ where: { status: { in: ["queued", "running", "retrying", "waiting_for_admin"] } }, select: { id: true, type: true, status: true, vpsInstanceId: true, vmid: true, updatedAt: true }, orderBy: { createdAt: "asc" }, take: 50 }),
  },
  {
    name: "recent_orders",
    run: () => prisma.order.findMany({ where: { deletedAt: null }, select: { id: true, customerId: true, status: true, provisioningStatus: true, vmId: true, updatedAt: true }, orderBy: { createdAt: "desc" }, take: 50 }),
  },
]

async function main() {
  const results: Array<{ name: string; p95Ms: number; maxMs: number; samples: number }> = []
  for (const check of checks) {
    await check.run()
    const samples: number[] = []
    for (let index = 0; index < iterations; index += 1) {
      const started = performance.now()
      await check.run()
      samples.push(Number((performance.now() - started).toFixed(2)))
    }
    results.push({ name: check.name, p95Ms: percentile(samples, 0.95), maxMs: Math.max(...samples), samples: samples.length })
  }
  const failed = results.filter((row) => row.p95Ms >= thresholdMs)
  console.log(JSON.stringify({ thresholdMs, passed: failed.length === 0, results, failed: failed.map((row) => row.name) }, null, 2))
  if (failed.length) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())
