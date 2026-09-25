import "dotenv/config"
import { prisma } from "@/lib/db"
import { releaseIpAllocation } from "@/lib/ip-pool"
import { proxmox } from "@/lib/proxmox"

/**
 * Orphan cleaner (WS11 / bug #13).
 *
 * Detects, and — only with --apply — repairs the unambiguous cases:
 *   1. Duplicate non-deleted VpsInstance rows for one order (report only; which one is canonical is a
 *      human decision — WS8 prevents NEW duplicates so this is for pre-existing rows).
 *   2. IP allocations still marked in-use but tied to a deleted/absent VPS (release on --apply).
 *   3. Proxmox VMs (non-template) not linked to any active VpsInstance (advisory report only; never
 *      auto-purged here — do that deliberately via the admin VM tools).
 *
 * Default is report-only. Pass --apply to release orphan IPs.
 */
const APPLY = process.argv.includes("--apply")

async function main() {
  const duplicateVmOrders: Array<{ orderId: string; count: number; vms: Array<{ id: string; vmid: number | null; status: string }> }> = []
  const orphanIps: Array<{ id: string; ipAddress: string; status: string; vpsInstanceId: string | null; reason: string }> = []
  const unlinkedProxmoxVms: Array<Record<string, unknown>> = []
  let releasedIps = 0

  // 1. Duplicate non-deleted VpsInstance per order.
  const vms = await prisma.vpsInstance.findMany({
    where: { deletedAt: null },
    select: { id: true, orderId: true, vmid: true, status: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  })
  const byOrder = new Map<string, typeof vms>()
  for (const vm of vms) {
    const key = String(vm.orderId)
    if (!byOrder.has(key)) byOrder.set(key, [])
    byOrder.get(key)!.push(vm)
  }
  for (const [orderId, list] of Array.from(byOrder.entries())) {
    if (list.length > 1) {
      duplicateVmOrders.push({ orderId, count: list.length, vms: list.map((v) => ({ id: v.id, vmid: v.vmid, status: v.status })) })
    }
  }

  // 2. Orphan IP allocations — marked in-use but no live VPS backs them.
  const allocs = await prisma.ipAllocation.findMany({
    where: { releasedAt: null, status: { notIn: ["free", "released", "FREE", "RELEASED", "Free", "Released"] } },
    select: { id: true, ipAddress: true, vpsInstanceId: true, status: true, vpsInstance: { select: { id: true, deletedAt: true } } },
  })
  for (const a of allocs) {
    const reason = !a.vpsInstanceId ? "no_vps_link" : !a.vpsInstance ? "vps_missing" : a.vpsInstance.deletedAt ? "vps_deleted" : ""
    if (!reason) continue
    orphanIps.push({ id: a.id, ipAddress: a.ipAddress, status: a.status, vpsInstanceId: a.vpsInstanceId, reason })
    if (APPLY) {
      await releaseIpAllocation(a.id).catch((err) => console.warn(`[repair-orphan-vms] release ${a.id} failed: ${err?.message || err}`))
      releasedIps++
    }
  }

  // 3. Proxmox VMs not linked to any active VpsInstance (advisory only).
  try {
    const resources = await proxmox.getClusterResources()
    const dbVmids = new Set(
      (await prisma.vpsInstance.findMany({ where: { deletedAt: null, vmid: { gt: 0 } }, select: { vmid: true } })).map((v) => Number(v.vmid)),
    )
    for (const r of Array.isArray(resources) ? resources : []) {
      if (r?.type !== "qemu" || r?.template) continue
      const vmid = Number(r.vmid)
      if (Number.isFinite(vmid) && vmid >= 100 && !dbVmids.has(vmid)) {
        unlinkedProxmoxVms.push({ vmid, node: r.node, name: r.name, status: r.status })
      }
    }
  } catch (err: any) {
    unlinkedProxmoxVms.push({ skipped: `Proxmox check unavailable: ${err?.message || err}` })
  }

  console.log(
    JSON.stringify(
      {
        mode: APPLY ? "apply" : "report",
        duplicateVmOrderCount: duplicateVmOrders.length,
        orphanIpCount: orphanIps.length,
        releasedIps,
        unlinkedProxmoxVmCount: unlinkedProxmoxVms.filter((v) => !v.skipped).length,
        duplicateVmOrders,
        orphanIps,
        unlinkedProxmoxVms,
      },
      null,
      2,
    ),
  )
}

main()
  .then(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error("[repair-orphan-vms] failed", err)
    await prisma.$disconnect().catch(() => null)
    process.exit(1)
  })
