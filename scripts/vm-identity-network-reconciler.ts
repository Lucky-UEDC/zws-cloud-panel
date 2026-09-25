import { scanAndRelinkVmsByOrderTags } from "@/lib/admin-vm-management"
import { runVmNetworkValidationWorker } from "@/lib/vm-network-orchestrator"

const once = process.argv.includes("--once")
const intervalMs = Math.max(60_000, Number(process.env.VM_IDENTITY_RECONCILE_INTERVAL_MS || 5 * 60 * 1000))
const limit = Math.max(10, Number(process.env.VM_IDENTITY_RECONCILE_LIMIT || 200))
const autoRepair = process.env.VM_IDENTITY_RECONCILE_AUTO_REPAIR !== "false"

async function tick() {
  const started = Date.now()
  const relink = await scanAndRelinkVmsByOrderTags({ actorEmail: "worker:vm-identity-reconciler" })
  const validation = await runVmNetworkValidationWorker({ actor: "worker:vm-identity-reconciler", limit, autoRepair })
  console.log("[vm-identity-network-reconciler] tick", {
    relinkScanned: relink.scanned,
    relinkUpdated: relink.updated,
    relinkConflicts: relink.conflicts,
    networkScanned: validation.scanned,
    networkWithIssues: validation.withIssues,
    networkRepaired: validation.repaired,
    networkFlagged: validation.flagged,
    tookMs: Date.now() - started,
  })
  return relink.updated > 0 || validation.withIssues > 0
}

async function run() {
  console.log("[vm-identity-network-reconciler] started", { once, intervalMs, limit, autoRepair })
  do {
    const didWork = await tick().catch((error) => {
      console.error("[vm-identity-network-reconciler] tick failed", error)
      return false
    })
    if (once) break
    await new Promise((resolve) => setTimeout(resolve, didWork ? Math.min(intervalMs, 60_000) : intervalMs))
  } while (true)
}

run().catch((error) => {
  console.error("[vm-identity-network-reconciler] fatal", error)
  process.exit(1)
})
