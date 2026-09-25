import { scanAndRelinkVmsByOrderTags } from "@/lib/admin-vm-management"

async function main() {
  const result = await scanAndRelinkVmsByOrderTags({
    actorEmail: "worker:vm-relink",
  })
  console.log("[vm-relink-worker] completed", {
    scanned: result.scanned,
    updated: result.updated,
    conflicts: result.conflicts,
    details: result.details.length,
  })
}

main().catch((error) => {
  console.error("[vm-relink-worker] failed", error?.message || error)
  process.exit(1)
})
