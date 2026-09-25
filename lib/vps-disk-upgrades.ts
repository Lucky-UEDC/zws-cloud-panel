import { prisma } from "@/lib/db"
import { calculatePricing } from "@/lib/payments/calculate-pricing"
import { createInvoiceForOrder } from "@/lib/invoices"
import { enqueueUpgradeJob } from "@/lib/provision"
import { snapshotStoragePool, storageTypeLabel } from "@/lib/storage-pools"

export const MAX_DISK_SIZE_GB = 16 * 1024
export const DISK_ORDER_TYPES = ["DISK_RESIZE", "DISK_MIGRATE", "DISK_ADD"] as const
export type DiskOrderType = (typeof DISK_ORDER_TYPES)[number]

type DiskOperation = "resize" | "migrate" | "add"

function money(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0
}

function termMonths(vps: any) {
  return Math.max(1, Number(vps.billingCycle === "yearly" ? 12 : vps.order?.termMonths || 1))
}

export async function ensureVpsDisks(vpsId: string) {
  const existing = await prisma.vpsDisk.findMany({ where: { vpsId, status: { not: "DELETED" } }, include: { storagePool: true }, orderBy: [{ isPrimary: "desc" }, { displayName: "asc" }] })
  if (existing.length) return existing
  const vps = await prisma.vpsInstance.findUnique({ where: { id: vpsId }, include: { product: true } })
  if (!vps) return []
  const disk = await prisma.vpsDisk.create({
    data: {
      vpsId: vps.id,
      proxmoxDiskKey: "scsi0",
      displayName: "disk1",
      sizeGb: Math.max(1, Number(vps.diskGb || vps.product?.storageGb || 1)),
      storagePoolId: vps.storagePoolId || null,
      isPrimary: true,
      status: "ACTIVE",
      metadata: { source: "lazy_backfill" },
    },
    include: { storagePool: true },
  })
  return [disk]
}

export async function diskUpgradeContext(vpsId: string, customerId: string) {
  const vps = await prisma.vpsInstance.findFirst({
    where: { id: vpsId, customerId, deletedAt: null, status: { not: "DELETED" } },
    include: { order: true, product: true, storagePool: true, proxmoxNode: true },
  })
  if (!vps) throw new Error("Instance not found")
  const disks = await ensureVpsDisks(vps.id)
  const pools = await prisma.nodeStoragePoolConfig.findMany({
    where: {
      proxmoxNodeId: vps.proxmoxNodeId || undefined,
      enabled: true,
      missingFromProxmox: false,
      OR: [{ isCustomerSelectable: true }, { allowUpgrade: true }, { isUpgradeOnly: true }, { id: vps.storagePoolId || "" }],
    },
    orderBy: [{ isPremium: "asc" }, { pricePerGbMonthly: "asc" }, { sortOrder: "asc" }, { storageId: "asc" }],
  })
  return { vps, disks, pools }
}

export async function quoteDiskUpgrade(input: {
  vpsId: string
  customerId: string
  operation: DiskOperation
  diskId?: string | null
  targetSizeGb?: number | null
  targetStoragePoolId?: string | null
}) {
  const { vps, disks, pools } = await diskUpgradeContext(input.vpsId, input.customerId)
  const operation = input.operation
  if (!["resize", "migrate", "add"].includes(operation)) throw new Error("Invalid disk upgrade operation.")
  const selectedDisk = operation === "add" ? null : disks.find((disk) => disk.id === input.diskId)
  if (operation !== "add" && !selectedDisk) throw new Error("Select a disk to upgrade.")
  if (["UPGRADE_QUEUED", "UPDATING_CONFIG", "RESIZING_DISK", "DISK_MIGRATING", "DISK_ADDING"].includes(String(vps.status).toUpperCase())) {
    throw new Error("Another disk or upgrade operation is already pending for this VPS.")
  }
  const pendingJob = await prisma.provisioningJob.findFirst({
    where: { vpsInstanceId: vps.id, type: "upgrade", status: { in: ["queued", "running"] } },
    select: { id: true },
  })
  if (pendingJob) throw new Error("Another disk or upgrade operation is already pending for this VPS.")

  const currentSizeGb = Number(selectedDisk?.sizeGb || 0)
  const targetSizeGb = Math.round(Number(input.targetSizeGb || currentSizeGb))
  if (operation !== "migrate" && (!Number.isFinite(targetSizeGb) || targetSizeGb < 1)) throw new Error("Enter a valid target disk size.")
  if ((operation === "resize" || operation === "migrate") && targetSizeGb < currentSizeGb) throw new Error("Disk size can only increase.")
  if (targetSizeGb > MAX_DISK_SIZE_GB) throw new Error("Maximum single disk size is 16 TB.")

  const currentPool = selectedDisk?.storagePool || vps.storagePool || null
  const targetPool = pools.find((pool) => pool.id === (input.targetStoragePoolId || selectedDisk?.storagePoolId || vps.storagePoolId))
  if (!targetPool) throw new Error("Selected storage pool is unavailable.")
  if (targetPool.enabled === false || targetPool.missingFromProxmox) throw new Error("Selected storage pool is disabled.")

  const extraSizeGb = operation === "add" ? targetSizeGb : Math.max(0, targetSizeGb - currentSizeGb)
  const currentPoolPrice = money(currentPool?.pricePerGbMonthly)
  const targetPoolPrice = money(targetPool.pricePerGbMonthly)
  const sizeIncreaseDelta = money(extraSizeGb * targetPoolPrice)
  const poolDifferenceDelta = operation === "add" ? 0 : money(Math.max(0, targetPoolPrice - currentPoolPrice) * currentSizeGb)
  const monthlyIncrease = money(sizeIncreaseDelta + poolDifferenceDelta)
  if (monthlyIncrease <= 0 && operation !== "migrate") throw new Error("Select a larger disk size or premium storage pool.")
  const term = termMonths(vps)
  const subtotal = money(monthlyIncrease * term)
  const pricing = calculatePricing({ subtotal, discount: 0, gstRate: 18, gstEnabled: true })
  const orderType: DiskOrderType = operation === "add" ? "DISK_ADD" : operation === "migrate" && extraSizeGb === 0 ? "DISK_MIGRATE" : operation === "migrate" ? "DISK_MIGRATE" : "DISK_RESIZE"

  return {
    operation,
    orderType,
    vps: {
      id: vps.id,
      name: vps.name,
      status: vps.status,
      ipAddress: vps.ipAddress,
      billingTermMonths: term,
    },
    disk: selectedDisk ? {
      id: selectedDisk.id,
      proxmoxDiskKey: selectedDisk.proxmoxDiskKey,
      displayName: selectedDisk.displayName,
      sizeGb: selectedDisk.sizeGb,
    } : null,
    targetSizeGb,
    currentSizeGb,
    extraSizeGb,
    currentPool: currentPool ? { id: currentPool.id, displayName: currentPool.displayName || currentPool.storageId, storageType: storageTypeLabel(currentPool), pricePerGbMonthInr: currentPoolPrice } : null,
    targetPool: { id: targetPool.id, displayName: targetPool.displayName || targetPool.storageId, storageType: storageTypeLabel(targetPool), pricePerGbMonthInr: targetPoolPrice, isPremium: Boolean(targetPool.isPremium || targetPool.premium) },
    sizeIncreaseDelta,
    poolDifferenceDelta,
    monthlyIncrease,
    termSubtotal: subtotal,
    pricing,
    payableToday: pricing.total,
    storagePoolSnapshot: snapshotStoragePool(targetPool, { includedDiskGb: operation === "add" ? 0 : currentSizeGb, diskGb: targetSizeGb }),
  }
}

export async function createDiskUpgradeOrder(input: {
  vpsId: string
  customerId: string
  operation: DiskOperation
  diskId?: string | null
  targetSizeGb?: number | null
  targetStoragePoolId?: string | null
}) {
  const quote = await quoteDiskUpgrade(input)
  const orderNumber = `DSK-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
  const order = await prisma.order.create({
    data: {
      orderNumber,
      customerId: input.customerId,
      productId: undefined,
      termMonths: quote.vps.billingTermMonths,
      unitPrice: quote.pricing.total,
      quantity: 1,
      subtotal: quote.pricing.subtotal,
      taxAmount: quote.pricing.gst,
      discountAmount: quote.pricing.discount,
      totalAmount: quote.pricing.total,
      originalAmount: quote.pricing.subtotal,
      finalAmount: quote.pricing.total,
      payableAmount: quote.pricing.total,
      orderType: quote.orderType,
      currency: "INR",
      status: quote.pricing.total <= 0 ? "paid" : "pending",
      provisioningStatus: quote.pricing.total <= 0 ? "UPGRADE_QUEUED" : "pending",
      metadata: {
        kind: "disk_upgrade",
        orderType: quote.orderType,
        pricingSnapshot: quote.pricing,
        diskUpgrade: quote,
        upgrade: {
          vpsInstanceId: input.vpsId,
          diskOperation: quote.operation,
          orderType: quote.orderType,
        },
      },
    },
  })
  if (quote.pricing.total <= 0) {
    await createInvoiceForOrder(order.id).catch(() => null)
    await enqueueUpgradeJob(order.id, "free-disk-upgrade").catch(() => null)
  }
  return { order, quote }
}
