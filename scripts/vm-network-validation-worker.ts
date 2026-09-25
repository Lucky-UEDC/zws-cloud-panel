import { runVmNetworkValidationWorker } from "@/lib/vm-network-orchestrator"

const once = process.argv.includes("--once")
const intervalMs = Math.max(60_000, Number(process.env.VM_NETWORK_VALIDATION_INTERVAL_MS || 5 * 60 * 1000))
const limit = Math.max(10, Number(process.env.VM_NETWORK_VALIDATION_LIMIT || 200))
const autoRepair = process.env.VM_NETWORK_VALIDATION_AUTO_REPAIR !== "false"

async function tick() {
  const started = Date.now()
  const result = await runVmNetworkValidationWorker({
    actor: "worker:vm-network-validation",
    limit,
    autoRepair,
  })
  console.log("[VmNetworkValidationWorker] tick", {
    scanned: result.scanned,
    withIssues: result.withIssues,
    repaired: result.repaired,
    flagged: result.flagged,
    tookMs: Date.now() - started,
    autoRepair,
  })
  return result.withIssues > 0
}

async function run() {
  console.log("[VmNetworkValidationWorker] started", { once, intervalMs, limit, autoRepair })
  do {
    const didWork = await tick().catch((error) => {
      console.error("[VmNetworkValidationWorker] tick failed", error)
      return false
    })
    if (once) break
    await new Promise((resolve) => setTimeout(resolve, didWork ? Math.min(intervalMs, 60_000) : intervalMs))
  } while (true)
}

run()
  .catch((error) => {
    console.error("[VmNetworkValidationWorker] fatal", error)
    process.exitCode = 1
  })
  .finally(() => {
    if (once) process.exit(process.exitCode || 0)
  })
