import "dotenv/config"
import { prisma } from "@/lib/db"

// READ-ONLY fleet audit: locate the test VM (vmid 25000), and check for duplicate VMs
// (same order with >1 non-deleted VpsInstance, or same node+vmid used by >1 row).
async function main() {
  const target = await prisma.vpsInstance.findMany({
    where: { vmid: 25000 },
    select: {
      id: true, vmid: true, name: true, instanceName: true, hostname: true, ipAddress: true,
      status: true, diskGb: true, cpuCores: true, ramGb: true, orderId: true, customerId: true,
      deletedAt: true, proxmoxNodeId: true,
      proxmoxNode: { select: { nodeName: true, status: true } },
      order: { select: { orderNumber: true, status: true, provisioningStatus: true } },
    },
  })

  const active = await prisma.vpsInstance.findMany({
    where: { deletedAt: null },
    select: { id: true, orderId: true, vmid: true, status: true, proxmoxNodeId: true },
  })

  const byOrder = new Map<string, typeof active>()
  for (const v of active) {
    const k = String(v.orderId)
    if (!byOrder.has(k)) byOrder.set(k, [])
    byOrder.get(k)!.push(v)
  }
  const duplicateOrders = Array.from(byOrder.entries())
    .filter(([, l]) => l.length > 1)
    .map(([orderId, l]) => ({ orderId, count: l.length, vms: l.map((x) => ({ id: x.id, vmid: x.vmid, status: x.status })) }))

  const byNodeVmid = new Map<string, string[]>()
  for (const v of active) {
    const k = `${v.proxmoxNodeId}:${v.vmid}`
    if (!byNodeVmid.has(k)) byNodeVmid.set(k, [])
    byNodeVmid.get(k)!.push(v.id)
  }
  const duplicateNodeVmid = Array.from(byNodeVmid.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, count: ids.length, ids }))

  console.log(JSON.stringify({
    activeVpsCount: active.length,
    target_vmid_25000: target.length ? target : "NOT FOUND in vps_instances",
    duplicateOrderCount: duplicateOrders.length,
    duplicateNodeVmidCount: duplicateNodeVmid.length,
    duplicateOrders,
    duplicateNodeVmid,
  }, null, 2))
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(0) })
  .catch(async (err) => { console.error("[audit] failed", err); await prisma.$disconnect().catch(() => null); process.exit(1) })
