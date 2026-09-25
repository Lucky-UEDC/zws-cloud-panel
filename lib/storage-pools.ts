import { computeNodeSections } from "@/lib/compute-node-monitoring"
import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"

export const STORAGE_TYPES = ["HDD", "SSD", "NVME", "NVME_GEN4", "NVME_GEN5", "CUSTOM", "LOCAL", "NVME2"] as const

export type StorageTypeCode = (typeof STORAGE_TYPES)[number]

export type StoragePoolSnapshot = {
  id: string
  nodeId: string
  proxmoxNodeId: string
  proxmoxStorageId: string
  storageId: string
  displayName: string
  storageType: string
  customStorageLabel?: string | null
  pricePerGbMonthly: number
  includedDiskGb: number
  extraDiskGb: number
  diskMonthlyCost: number
  selectedAt: string
  premium: boolean
  isPremium: boolean
  isCustomerSelectable: boolean
  isUpgradeOnly: boolean
}

export function normalizeStorageType(value: unknown): StorageTypeCode {
  const raw = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_")
  if (raw === "NVME_GEN_4" || raw === "NVME4" || raw === "GEN4") return "NVME_GEN4"
  if (raw === "NVME_GEN_5" || raw === "NVME5" || raw === "GEN5") return "NVME_GEN5"
  if (raw === "NVME_2") return "NVME2"
  if ((STORAGE_TYPES as readonly string[]).includes(raw)) return raw as StorageTypeCode
  if (raw.includes("NVME") && raw.includes("5")) return "NVME_GEN5"
  if (raw.includes("NVME") && raw.includes("4")) return "NVME_GEN4"
  if (raw.includes("NVME") && raw.includes("2")) return "NVME2"
  if (raw.includes("NVME")) return "NVME"
  if (raw.includes("SSD")) return "SSD"
  if (raw.includes("HDD")) return "HDD"
  if (raw.includes("LOCAL")) return "LOCAL"
  return "CUSTOM"
}

export function storageTypeLabel(pool: any) {
  const type = normalizeStorageType(pool?.storageType || pool?.type)
  if (type === "CUSTOM") return pool?.customStorageLabel || "Custom"
  if (type === "NVME_GEN4") return "NVMe Gen4"
  if (type === "NVME_GEN5") return "NVMe Gen5"
  if (type === "NVME2") return "NVMe2"
  if (type === "NVME") return "NVMe"
  return type
}

export function normalizeStoragePoolPatch(input: Record<string, any>) {
  const patch = { ...input }
  if (patch.proxmoxStorageId !== undefined) delete patch.proxmoxStorageId
  if (patch.storageId !== undefined) delete patch.storageId
  if (patch.diskClass !== undefined && patch.storageType === undefined) patch.storageType = patch.diskClass
  if (patch.customDiskLabel !== undefined && patch.customStorageLabel === undefined) patch.customStorageLabel = patch.customDiskLabel
  if (patch.pricePerGbMonthInr !== undefined && patch.pricePerGbMonthly === undefined) patch.pricePerGbMonthly = patch.pricePerGbMonthInr
  if (patch.minDiskSizeGb !== undefined && patch.minGb === undefined) patch.minGb = patch.minDiskSizeGb
  if (patch.maxDiskSizeGb !== undefined && patch.maxGb === undefined) patch.maxGb = patch.maxDiskSizeGb
  if (patch.isDefaultForNewVms !== undefined && patch.defaultForNewVm === undefined) patch.defaultForNewVm = patch.isDefaultForNewVms
  if (patch.defaultDiskTarget !== undefined && patch.defaultForVmDisk === undefined) patch.defaultForVmDisk = patch.defaultDiskTarget
  if (patch.defaultTemplateTarget !== undefined && patch.defaultForTemplate === undefined) patch.defaultForTemplate = patch.defaultTemplateTarget
  if (patch.backupStorage !== undefined && patch.defaultForBackup === undefined) patch.defaultForBackup = patch.backupStorage
  if (patch.storagePriority !== undefined && patch.priority === undefined) patch.priority = patch.storagePriority
  if (patch.isEnabled !== undefined && patch.enabled === undefined) patch.enabled = patch.isEnabled
  return patch
}

export function serializeStoragePoolConfig(config: any) {
  const pricePerGbMonthly = Number(config.pricePerGbMonthly || 0)
  const diskClass = normalizeStorageType(config.storageType || config.type)
  const customDiskLabel = config.customStorageLabel || null
  return {
    ...config,
    proxmoxStorageId: config.storageId,
    diskClass,
    customDiskLabel,
    pricePerGbMonthInr: pricePerGbMonthly,
    minDiskSizeGb: config.minGb,
    maxDiskSizeGb: config.maxGb,
    isDefaultForNewVms: Boolean(config.defaultForNewVm),
    defaultDiskTarget: Boolean(config.defaultForVmDisk || config.defaultForNewVm),
    defaultTemplateTarget: Boolean(config.defaultForTemplate),
    backupStorage: Boolean(config.defaultForBackup),
    storagePriority: Number(config.priority ?? config.sortOrder ?? 100),
    healthStatus: config.healthStatus || "unknown",
    supportedContent: Array.isArray(config.supportedContent) ? config.supportedContent : [],
    lastHealthCheckedAt: config.lastHealthCheckedAt?.toISOString ? config.lastHealthCheckedAt.toISOString() : config.lastHealthCheckedAt || null,
    isEnabled: Boolean(config.enabled),
    totalBytes: config.totalBytes == null ? null : Number(config.totalBytes),
    usedBytes: config.usedBytes == null ? null : Number(config.usedBytes),
    freeBytes: config.freeBytes == null ? null : Number(config.freeBytes),
    availableBytes: config.availableBytes == null ? null : Number(config.availableBytes),
    pricePerGbMonthly,
    storageType: diskClass,
    customStorageLabel: customDiskLabel,
  }
}

function storageIdentityCandidates(poolId: string, patch: Record<string, any>) {
  return Array.from(new Set([
    String(poolId || "").trim(),
    String(patch.id || "").trim(),
    String(patch.storageId || "").trim(),
    String(patch.proxmoxStorageId || "").trim(),
  ].filter(Boolean)))
}

export async function resolveStoragePoolConfigForUpdate(poolId: string, patch: Record<string, any>) {
  const direct = await prisma.nodeStoragePoolConfig.findUnique({ where: { id: poolId } })
  if (direct) return { pool: direct, resolvedBy: "id" as const }

  const proxmoxNodeId = String(patch.proxmoxNodeId || patch.nodeId || "").trim()
  const candidates = storageIdentityCandidates(poolId, patch)
  if (proxmoxNodeId) {
    await syncNodeStoragePools(proxmoxNodeId).catch((error) => {
      console.warn("[storage-pools] update fallback sync failed", {
        proxmoxNodeId,
        poolId,
        message: error?.message || String(error),
      })
    })
    const byStorageId = await prisma.nodeStoragePoolConfig.findFirst({
      where: {
        proxmoxNodeId,
        OR: [
          { id: { in: candidates } },
          { storageId: { in: candidates } },
        ],
      },
    })
    if (byStorageId) return { pool: byStorageId, resolvedBy: "node_storage_id" as const }
  }

  const byStorageOnly = candidates.length
    ? await prisma.nodeStoragePoolConfig.findFirst({
        where: { storageId: { in: candidates } },
        orderBy: [{ missingFromProxmox: "asc" }, { updatedAt: "desc" }],
      })
    : null
  if (byStorageOnly) return { pool: byStorageOnly, resolvedBy: "storage_id" as const }

  return { pool: null, resolvedBy: "missing" as const }
}

function bytes(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = BigInt(Math.max(0, Math.floor(Number(value))))
  return parsed
}

function hasCapacity(pool: any, requestedGb?: number | null) {
  const requested = Math.max(0, Number(requestedGb || 0))
  if (!requested) return true
  const free = pool?.availableBytes ?? pool?.freeBytes
  if (free === null || free === undefined) return true
  return Number(free) / 1024 / 1024 / 1024 >= requested
}

function activePurchaseWhere(proxmoxNodeId: string) {
  return {
    proxmoxNodeId,
    enabled: true,
    missingFromProxmox: false,
    isUpgradeOnly: false,
  }
}

function money(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0
}

async function ensureStoragePoolsFresh(proxmoxNodeId: string, requestedPoolId?: string | null) {
  const staleBefore = new Date(Date.now() - Number(process.env.STORAGE_POOL_CACHE_TTL_MS || 5 * 60_000))
  const [poolCount, requestedPool, staleCount] = await Promise.all([
    prisma.nodeStoragePoolConfig.count({ where: { proxmoxNodeId } }).catch(() => 0),
    requestedPoolId
      ? prisma.nodeStoragePoolConfig.findFirst({ where: { id: requestedPoolId, proxmoxNodeId }, select: { id: true } }).catch(() => null)
      : Promise.resolve(null),
    prisma.nodeStoragePoolConfig.count({
      where: {
        proxmoxNodeId,
        OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: staleBefore } }],
      },
    }).catch(() => 0),
  ])
  if (poolCount === 0 || staleCount > 0 || (requestedPoolId && !requestedPool)) {
    await syncNodeStoragePools(proxmoxNodeId).catch((error) => {
      console.warn("[storage-pools] auto resync failed", {
        proxmoxNodeId,
        requestedPoolId: requestedPoolId || null,
        message: error?.message || String(error),
      })
    })
  }
}

export function snapshotStoragePool(pool: any, input: { includedDiskGb?: number; diskGb?: number } = {}): StoragePoolSnapshot | null {
  if (!pool) return null
  const includedDiskGb = Math.max(0, Number(input.includedDiskGb ?? input.diskGb ?? 0))
  const diskGb = Math.max(0, Number(input.diskGb ?? includedDiskGb))
  const extraDiskGb = Math.max(0, diskGb - includedDiskGb)
  const pricePerGbMonthly = money(pool.pricePerGbMonthly)
  return {
    id: pool.id,
    nodeId: pool.proxmoxNodeId,
    proxmoxNodeId: pool.proxmoxNodeId,
    proxmoxStorageId: pool.storageId,
    storageId: pool.storageId,
    displayName: pool.displayName || pool.storageId,
    storageType: normalizeStorageType(pool.storageType || pool.type),
    customStorageLabel: pool.customStorageLabel || null,
    pricePerGbMonthly,
    includedDiskGb,
    extraDiskGb,
    diskMonthlyCost: money(extraDiskGb * pricePerGbMonthly),
    selectedAt: new Date().toISOString(),
    premium: Boolean(pool.isPremium || pool.premium),
    isPremium: Boolean(pool.isPremium || pool.premium),
    isCustomerSelectable: Boolean(pool.isCustomerSelectable || pool.allowNewPurchase),
    isUpgradeOnly: Boolean(pool.isUpgradeOnly),
  }
}

export async function validateStoragePoolPatch(pool: any, patch: Record<string, any>) {
  const price = patch.pricePerGbMonthly === undefined ? Number(pool.pricePerGbMonthly || 0) : Number(patch.pricePerGbMonthly)
  const minGb = patch.minGb === undefined ? Number(pool.minGb || 1) : Number(patch.minGb)
  const maxGb = patch.maxGb === undefined || patch.maxGb === null || patch.maxGb === "" ? pool.maxGb : Number(patch.maxGb)
  const enabled = patch.enabled === undefined ? Boolean(pool.enabled) : Boolean(patch.enabled)
  const isDefault = patch.defaultForNewVm === undefined ? Boolean(pool.defaultForNewVm) : Boolean(patch.defaultForNewVm)
  const isUpgradeOnly = patch.isUpgradeOnly === undefined ? Boolean(pool.isUpgradeOnly) : Boolean(patch.isUpgradeOnly)
  const selectable = patch.isCustomerSelectable === undefined ? Boolean(pool.isCustomerSelectable) : Boolean(patch.isCustomerSelectable)

  if (!Number.isFinite(price) || price < 0) throw new Error("Price per GB must be zero or greater.")
  if (!Number.isFinite(minGb) || minGb < 1) throw new Error("Minimum disk size must be at least 1 GB.")
  if (maxGb !== null && maxGb !== undefined && (!Number.isFinite(Number(maxGb)) || Number(maxGb) <= minGb)) {
    throw new Error("Maximum disk size must be greater than minimum disk size.")
  }
  if (isDefault && !enabled) throw new Error("Default storage pool must be enabled.")
  if (isDefault && isUpgradeOnly) throw new Error("Upgrade-only storage pool cannot be the default.")
  if (selectable && !enabled) throw new Error("Customer-selectable storage pool must be enabled.")
  if (!enabled && pool.defaultForNewVm) throw new Error("Select another default storage pool before disabling this one.")

  if (!enabled) {
    const activeProducts = await prisma.product.count({
      where: {
        isActive: true,
        status: "active",
        OR: [
          { defaultStoragePoolId: pool.id },
          { requiredStoragePoolId: pool.id },
          { storagePolicyType: "EXACT_POOL", requiredStoragePoolId: pool.id },
        ],
      },
    })
    if (activeProducts > 0) throw new Error("This storage pool is used by active products and cannot be disabled.")
  }
}

export async function updateStoragePoolConfig(poolId: string, patch: Record<string, any>, actorEmail?: string | null) {
  const resolved = await resolveStoragePoolConfigForUpdate(poolId, patch)
  const pool = resolved.pool
  if (!pool) throw new Error("Storage pool not found. Sync the node storage pools and retry.")
  patch = normalizeStoragePoolPatch(patch)
  await validateStoragePoolPatch(pool, patch)

  const makeDefault = patch.defaultForNewVm === true
  const makeDefaultDisk = patch.defaultForVmDisk === true
  const makeDefaultTemplate = patch.defaultForTemplate === true
  const makeDefaultBackup = patch.defaultForBackup === true
  return prisma.$transaction(async (tx) => {
    if (makeDefault || makeDefaultDisk) {
      await tx.nodeStoragePoolConfig.updateMany({
        where: { proxmoxNodeId: pool.proxmoxNodeId, id: { not: pool.id } },
        data: { defaultForNewVm: makeDefault ? false : undefined, defaultForVmDisk: makeDefaultDisk ? false : undefined },
      })
    }
    if (makeDefaultTemplate) {
      await tx.nodeStoragePoolConfig.updateMany({
        where: { proxmoxNodeId: pool.proxmoxNodeId, id: { not: pool.id } },
        data: { defaultForTemplate: false },
      })
    }
    if (makeDefaultBackup) {
      await tx.nodeStoragePoolConfig.updateMany({
        where: { proxmoxNodeId: pool.proxmoxNodeId, id: { not: pool.id } },
        data: { defaultForBackup: false },
      })
    }
    const isPremium = patch.isPremium ?? patch.premium
    const updated = await tx.nodeStoragePoolConfig.update({
      where: { id: pool.id },
      data: {
        displayName: patch.displayName === undefined ? undefined : String(patch.displayName || pool.storageId),
        storageType: patch.storageType === undefined ? undefined : normalizeStorageType(patch.storageType),
        customStorageLabel: patch.customStorageLabel === undefined ? undefined : String(patch.customStorageLabel || "").trim() || null,
        defaultForNewVm: patch.defaultForNewVm === undefined ? undefined : Boolean(patch.defaultForNewVm),
        defaultForVmDisk: patch.defaultForVmDisk === undefined ? undefined : Boolean(patch.defaultForVmDisk),
        defaultForTemplate: patch.defaultForTemplate === undefined ? undefined : Boolean(patch.defaultForTemplate),
        defaultForBackup: patch.defaultForBackup === undefined ? undefined : Boolean(patch.defaultForBackup),
        enabled: patch.enabled === undefined ? undefined : Boolean(patch.enabled),
        isCustomerSelectable: patch.isCustomerSelectable === undefined ? undefined : Boolean(patch.isCustomerSelectable),
        allowNewPurchase: patch.isCustomerSelectable === undefined ? undefined : Boolean(patch.isCustomerSelectable),
        isUpgradeOnly: patch.isUpgradeOnly === undefined ? undefined : Boolean(patch.isUpgradeOnly),
        allowUpgrade: patch.isUpgradeOnly === undefined ? undefined : Boolean(patch.isUpgradeOnly || patch.allowUpgrade),
        isPremium: isPremium === undefined ? undefined : Boolean(isPremium),
        premium: isPremium === undefined ? undefined : Boolean(isPremium),
        pricePerGbMonthly: patch.pricePerGbMonthly === undefined ? undefined : Number(patch.pricePerGbMonthly || 0),
        minGb: patch.minGb === undefined ? undefined : Math.max(1, Math.round(Number(patch.minGb || 1))),
        maxGb: patch.maxGb === undefined ? undefined : patch.maxGb === null || patch.maxGb === "" ? null : Math.round(Number(patch.maxGb)),
        priority: patch.priority === undefined ? undefined : Math.max(0, Math.round(Number(patch.priority || 100))),
        healthStatus: patch.healthStatus === undefined ? undefined : String(patch.healthStatus || "unknown"),
        supportedContent: patch.supportedContent === undefined ? undefined : Array.isArray(patch.supportedContent) ? patch.supportedContent : String(patch.supportedContent || "").split(",").map((item) => item.trim()).filter(Boolean),
        lastHealthCheckedAt: patch.healthStatus === undefined && patch.supportedContent === undefined ? undefined : new Date(),
        notes: patch.notes === undefined ? undefined : String(patch.notes || "").trim() || null,
      },
    })
    await createPanelLog({
      category: "Compute Node",
      message: makeDefault || makeDefaultDisk || makeDefaultTemplate || makeDefaultBackup ? "storage_pool_role_updated" : "storage_pool_updated",
      actorType: actorEmail ? "admin" : "system",
      actorEmail: actorEmail || null,
      metadata: { nodeId: pool.proxmoxNodeId, storagePoolId: pool.id, proxmoxStorageId: pool.storageId },
    })
    return updated
  })
}

export async function setDefaultStoragePool(poolId: string, actorEmail?: string | null) {
  return updateStoragePoolConfig(poolId, { defaultForNewVm: true, defaultForVmDisk: true, enabled: true, isUpgradeOnly: false }, actorEmail)
}

export async function setStoragePoolEnabled(poolId: string, enabled: boolean, actorEmail?: string | null) {
  const updated = await updateStoragePoolConfig(poolId, { enabled }, actorEmail)
  await createPanelLog({
    category: "Compute Node",
    message: enabled ? "storage_pool_enabled" : "storage_pool_disabled",
    actorType: actorEmail ? "admin" : "system",
    actorEmail: actorEmail || null,
    metadata: { nodeId: updated.proxmoxNodeId, storagePoolId: updated.id, proxmoxStorageId: updated.storageId },
  })
  return updated
}

export async function ensureOneDefaultStoragePool(proxmoxNodeId: string, preferredId?: string | null) {
  const pools = await prisma.nodeStoragePoolConfig.findMany({
    where: { proxmoxNodeId, enabled: true, missingFromProxmox: false, isUpgradeOnly: false },
    orderBy: [{ defaultForNewVm: "desc" }, { isPremium: "asc" }, { premium: "asc" }, { sortOrder: "asc" }, { storageId: "asc" }],
  })
  if (!pools.length) return null
  const selected = pools.find((pool) => pool.id === preferredId) || pools.find((pool) => pool.defaultForNewVm) || pools[0]
  await prisma.nodeStoragePoolConfig.updateMany({ where: { proxmoxNodeId, id: { not: selected.id } }, data: { defaultForNewVm: false } })
  return prisma.nodeStoragePoolConfig.update({ where: { id: selected.id }, data: { defaultForNewVm: true, enabled: true, isUpgradeOnly: false } })
}

export async function syncNodeStoragePools(proxmoxNodeId: string, actorEmail?: string | null) {
  const sections = await computeNodeSections(proxmoxNodeId)
  const rows = Array.isArray(sections.storage?.storage) ? sections.storage.storage : []
  const seen = new Set<string>()

  await Promise.all(rows.map((row: any, index: number) => {
    const storageId = String(row.name || row.storage || "").trim()
    if (!storageId) return Promise.resolve(null)
    seen.add(storageId)
    const proxmoxType = String(row.type || "")
    return prisma.nodeStoragePoolConfig.upsert({
      where: { proxmoxNodeId_storageId: { proxmoxNodeId, storageId } },
      update: {
        type: proxmoxType || undefined,
        proxmoxType: proxmoxType || undefined,
        totalBytes: bytes(row.totalBytes),
        usedBytes: bytes(row.usedBytes),
        freeBytes: bytes(row.freeBytes),
        availableBytes: bytes(row.freeBytes),
        sortOrder: index,
        priority: index,
        healthStatus: row.active === false || row.enabled === false ? "disabled" : "healthy",
        supportedContent: String(row.content || "").split(",").map((item) => item.trim()).filter(Boolean),
        lastHealthCheckedAt: new Date(),
        lastSyncedAt: new Date(),
        missingFromProxmox: false,
      },
      create: {
        proxmoxNodeId,
        storageId,
        displayName: storageId,
        type: proxmoxType || null,
        storageType: normalizeStorageType(`${storageId} ${proxmoxType}`),
        proxmoxType: proxmoxType || null,
        totalBytes: bytes(row.totalBytes),
        usedBytes: bytes(row.usedBytes),
        freeBytes: bytes(row.freeBytes),
        availableBytes: bytes(row.freeBytes),
        enabled: row.enabled !== false && row.active !== false,
        defaultForNewVm: index === 0,
        defaultForVmDisk: index === 0,
        defaultForTemplate: /vztmpl|images|iso/i.test(String((row as any).content || "")),
        defaultForBackup: /backup/i.test(String((row as any).content || "")),
        isCustomerSelectable: false,
        allowNewPurchase: false,
        isUpgradeOnly: false,
        allowUpgrade: false,
        isPremium: false,
        premium: false,
        minGb: 1,
        sortOrder: index,
        priority: index,
        healthStatus: row.active === false || row.enabled === false ? "disabled" : "healthy",
        supportedContent: String(row.content || "").split(",").map((item) => item.trim()).filter(Boolean),
        lastHealthCheckedAt: new Date(),
        lastSyncedAt: new Date(),
        missingFromProxmox: false,
      },
    })
  }))

  if (seen.size) {
    await prisma.nodeStoragePoolConfig.updateMany({
      where: { proxmoxNodeId, storageId: { notIn: Array.from(seen) } },
      data: { missingFromProxmox: true, enabled: false },
    })
    await ensureOneDefaultStoragePool(proxmoxNodeId).catch(() => null)
  }

  await createPanelLog({
    category: "Compute Node",
    message: "storage_pool_synced",
    actorType: actorEmail ? "admin" : "system",
    actorEmail: actorEmail || null,
    metadata: { nodeId: proxmoxNodeId, count: seen.size, errors: sections.storage?.errors || {} },
  })

  const configs = await prisma.nodeStoragePoolConfig.findMany({
    where: { proxmoxNodeId },
    orderBy: [{ sortOrder: "asc" }, { storageId: "asc" }],
  })
  return { ...sections.storage, configs }
}

export async function resolveStoragePoolForPurchase(input: {
  proxmoxNodeId?: string | null
  storagePoolId?: string | null
  storagePolicyType?: string | null
  requiredStorageType?: string | null
  requiredStoragePoolId?: string | null
  allowStorageFallback?: boolean | null
  allowPremiumNewPurchase?: boolean
  storageGb?: number | null
  forUpgrade?: boolean
}) {
  if (!input.proxmoxNodeId) return null
  await ensureStoragePoolsFresh(input.proxmoxNodeId, input.storagePoolId || input.requiredStoragePoolId || null)
  const base = input.forUpgrade
    ? { proxmoxNodeId: input.proxmoxNodeId, enabled: true, missingFromProxmox: false }
    : activePurchaseWhere(input.proxmoxNodeId)
  const allowed = (pool: any) => {
    if (!pool || !hasCapacity(pool, input.storageGb)) return false
    if (input.forUpgrade) return Boolean(pool.allowUpgrade || pool.isUpgradeOnly || pool.isCustomerSelectable)
    if (pool.isUpgradeOnly) return false
    if ((pool.isPremium || pool.premium) && !pool.isCustomerSelectable && !input.allowPremiumNewPurchase) return false
    return true
  }
  const findFirst = async (where: Record<string, any>) => {
    const pool = await prisma.nodeStoragePoolConfig.findFirst({
      where: { ...base, ...where },
      orderBy: [{ defaultForNewVm: "desc" }, { isPremium: "asc" }, { premium: "asc" }, { sortOrder: "asc" }, { storageId: "asc" }],
    })
    return allowed(pool) ? pool : null
  }

  if (input.storagePoolId) {
    const selected = await prisma.nodeStoragePoolConfig.findFirst({ where: { id: input.storagePoolId } })
    if (!selected) throw new Error("Selected storage pool mapping is missing. Sync storage pools from the compute node and try again.")
    if (selected.proxmoxNodeId !== input.proxmoxNodeId) throw new Error("Selected storage pool belongs to a different compute node.")
    if (selected.missingFromProxmox) throw new Error(`Selected storage pool '${selected.storageId}' is missing from Proxmox on this node.`)
    if (!selected.enabled) throw new Error(`Selected storage pool '${selected.storageId}' is disabled.`)
    if (!allowed(selected)) throw new Error(`Selected storage pool '${selected.storageId}' does not have enough capacity or is not available for this purchase.`)
    return selected
  }

  const policy = String(input.storagePolicyType || "").trim().toUpperCase()
  const exactPoolId = input.requiredStoragePoolId || null
  if ((policy === "EXACT_POOL" || exactPoolId) && exactPoolId) {
    const exact = await findFirst({ id: exactPoolId })
    if (exact || input.allowStorageFallback === false) {
      if (!exact && input.allowStorageFallback === false) throw new Error("Required storage pool is unavailable after Proxmox resync.")
      return exact
    }
  }

  if (policy === "STORAGE_CLASS" && input.requiredStorageType) {
    const classPool = await findFirst({ storageType: normalizeStorageType(input.requiredStorageType) })
    if (classPool || input.allowStorageFallback === false) {
      if (!classPool && input.allowStorageFallback === false) throw new Error(`Required storage class '${input.requiredStorageType}' is unavailable after Proxmox resync.`)
      return classPool
    }
  }

  const defaultPool = await findFirst({ defaultForNewVm: true })
  if (defaultPool) return defaultPool

  return findFirst({})
}

export async function customerSelectableStoragePools(nodeId?: string | null) {
  return prisma.nodeStoragePoolConfig.findMany({
    where: {
      enabled: true,
      missingFromProxmox: false,
      isCustomerSelectable: true,
      isUpgradeOnly: false,
      ...(nodeId ? { proxmoxNodeId: nodeId } : {}),
    },
    include: { proxmoxNode: { select: { id: true, name: true, nodeName: true, location: true, isActive: true } } },
    orderBy: [{ isPremium: "asc" }, { pricePerGbMonthly: "asc" }, { sortOrder: "asc" }, { storageId: "asc" }],
  })
}
