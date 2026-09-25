import "dotenv/config"
import { prisma } from "@/lib/db"
import { loadLiveVmSnapshot } from "@/lib/proxmox-live"
import { writeStructuredLog } from "@/lib/structured-logger"

const DRY_RUN = process.argv.includes("--dry-run")
const LIMIT = Math.max(1, Number(process.env.ORDER_VM_CONSISTENCY_LIMIT || process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] || 1000))

type RepairRow = {
  orderId: string
  orderNumber: string
  vpsId?: string | null
  changes: string[]
  skipped?: string[]
}

async function patch(model: "order" | "vpsInstance", id: string, data: Record<string, unknown>, changes: string[]) {
  if (!Object.keys(data).length) return
  changes.push(...Object.keys(data).map((key) => `${model}.${key}`))
  if (DRY_RUN) return
  if (model === "order") await prisma.order.update({ where: { id }, data: data as any })
  else await prisma.vpsInstance.update({ where: { id }, data: data as any })
}

async function findService(order: any) {
  if (order.vpsInstance) return order.vpsInstance
  if (order.serviceId) {
    const byId = await prisma.vpsInstance.findFirst({ where: { id: order.serviceId, deletedAt: null }, include: { proxmoxNode: true } })
    if (byId) return byId
  }
  return prisma.vpsInstance.findFirst({ where: { orderId: order.id, deletedAt: null }, include: { proxmoxNode: true }, orderBy: { createdAt: "desc" } })
}

async function activeMappingConflict(vps: any) {
  if (!vps?.proxmoxNodeId || !Number(vps.vmid || 0)) return null
  return prisma.vpsInstance.findFirst({
    where: {
      id: { not: vps.id },
      proxmoxNodeId: vps.proxmoxNodeId,
      vmid: Number(vps.vmid),
      deletedAt: null,
    },
    select: { id: true, orderId: true, customerId: true },
  })
}

async function activeIpConflict(vpsId: string, ipAddress?: string | null) {
  if (!ipAddress) return null
  return prisma.vpsInstance.findFirst({
    where: { id: { not: vpsId }, ipAddress, deletedAt: null },
    select: { id: true, orderId: true, customerId: true },
  })
}

async function repairOrder(order: any): Promise<RepairRow> {
  const row: RepairRow = { orderId: order.id, orderNumber: order.orderNumber, vpsId: null, changes: [], skipped: [] }
  const service = await findService(order)
  if (!service) {
    row.skipped?.push("vm_missing")
    return row
  }
  row.vpsId = service.id

  const mappingConflict = await activeMappingConflict(service)
  if (mappingConflict) row.skipped?.push(`mapping_conflict:${mappingConflict.id}`)

  const orderPatch: Record<string, unknown> = {}
  const vpsPatch: Record<string, unknown> = {}
  if (order.serviceId !== service.id) orderPatch.serviceId = service.id
  if (Number(order.vmId || 0) !== Number(service.vmid || 0)) orderPatch.vmId = Number(service.vmid || 0)
  if (service.proxmoxNode?.nodeName && order.proxmoxNode !== service.proxmoxNode.nodeName) orderPatch.proxmoxNode = service.proxmoxNode.nodeName
  if (order.customerId && service.customerId !== order.customerId) vpsPatch.customerId = order.customerId
  if (order.productId && service.productId !== order.productId) vpsPatch.productId = order.productId
  if (order.operatingSystemId && service.operatingSystemId !== order.operatingSystemId) vpsPatch.operatingSystemId = order.operatingSystemId

  if (!Number(service.vmid || 0)) row.skipped?.push("vmid_invalid")
  if (!service.proxmoxNodeId) row.skipped?.push("node_missing")

  if (!mappingConflict) {
    await patch("order", order.id, orderPatch, row.changes)
    await patch("vpsInstance", service.id, vpsPatch, row.changes)
  }

  const live = service.proxmoxNodeId && Number(service.vmid || 0)
    ? await loadLiveVmSnapshot(service.id, { syncDatabase: !DRY_RUN }).catch((error) => {
        row.skipped?.push(`proxmox_unreadable:${error?.message || "unknown"}`)
        return null
      })
    : null
  if (live?.error) row.skipped?.push(`proxmox_unreadable:${live.error}`)
  if (live?.ipAddress && live.ipAddress !== service.ipAddress) {
    const ipConflict = await activeIpConflict(service.id, live.ipAddress)
    if (ipConflict) row.skipped?.push(`ip_conflict:${live.ipAddress}:${ipConflict.id}`)
    else await patch("vpsInstance", service.id, { ipAddress: live.ipAddress }, row.changes)
  }
  if (live?.status && live.status !== service.status) {
    await patch("vpsInstance", service.id, { status: live.status }, row.changes)
  }

  await writeStructuredLog("proxmox-sync", "order_vm_consistency", {
    orderId: order.id,
    orderNumber: order.orderNumber,
    vpsInstanceId: service.id,
    changes: row.changes,
    skipped: row.skipped,
    dryRun: DRY_RUN,
  })
  if (!row.skipped?.length) delete row.skipped
  return row
}

async function main() {
  const orders = await prisma.order.findMany({
    where: {
      deletedAt: null,
      OR: [
        { serviceId: { not: null } },
        { vmId: { not: null } },
        { vpsInstance: { isNot: null } },
      ],
    },
    include: {
      vpsInstance: { include: { proxmoxNode: true } },
    },
    orderBy: { createdAt: "asc" },
    take: LIMIT,
  })
  const results: RepairRow[] = []
  for (const order of orders) {
    results.push(await repairOrder(order).catch((error) => {
      const row = { orderId: order.id, orderNumber: order.orderNumber, changes: [], skipped: [`error:${error?.message || String(error)}`] }
      void writeStructuredLog("proxmox-sync", "order_vm_consistency_failed", { orderId: order.id, orderNumber: order.orderNumber, error })
      return row
    }))
  }
  const changed = results.filter((row) => row.changes.length)
  const skipped = results.filter((row) => row.skipped?.length)
  console.log(JSON.stringify({
    success: true,
    dryRun: DRY_RUN,
    scanned: orders.length,
    changed: changed.length,
    skipped: skipped.length,
    results,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error("[repair-order-vm-consistency] failed", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
