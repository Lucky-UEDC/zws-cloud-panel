import { prisma } from "@/lib/db"
import { isEnterpriseIpamEnabledByEnv } from "@/lib/startup-schema-check"
import type { Prisma } from "@prisma/client"

type NodePoolAssignmentInput = {
  poolId: string
  priority?: number
  active?: boolean
  isDefault?: boolean
}

type ProductPoolAssignmentInput = {
  poolId: string
  priority?: number
  active?: boolean
  isDefault?: boolean
}

type PoolNodeAssignmentInput = {
  nodeId: string
  priority?: number
  active?: boolean
}

type PoolProductAssignmentInput = {
  productId: string
  priority?: number
  active?: boolean
}

type DbClient = typeof prisma | Prisma.TransactionClient

type NormalizedProductAssignment = {
  id: string
  productId: string
  poolId: string
  priority: number
  active: boolean
  isDefault: boolean
  allowPremium: boolean
  createdAt: Date
  updatedAt?: Date
  source: "canonical" | "legacy"
  pool?: any
  product?: any
}

type NormalizedNodeAssignment = {
  id: string
  nodeId: string
  poolId: string
  priority: number
  active: boolean
  isDefault: boolean
  createdAt: Date
  updatedAt?: Date
  source: "canonical" | "legacy"
  pool?: any
  node?: any
}

function isMissingIpamSchemaError(error: unknown) {
  const code = String((error as any)?.code || "")
  const message = String((error as any)?.message || "")
  return code === "P2021" || code === "P2022" || /pool_(node|product)_assignments|does not exist|column .* does not exist/i.test(message)
}

function sortAssignments<T extends { active: boolean; priority: number; createdAt: Date; id: string }>(rows: T[]) {
  return rows.sort((a, b) =>
    Number(b.active) - Number(a.active) ||
    Number(a.priority || 100) - Number(b.priority || 100) ||
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
    a.id.localeCompare(b.id)
  )
}

function canonicalProductRow(row: any): NormalizedProductAssignment {
  return {
    id: row.id,
    productId: row.productId,
    poolId: row.poolId,
    priority: Number(row.priority || 100),
    active: row.active !== false,
    isDefault: Number(row.priority || 100) <= 1,
    allowPremium: false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    source: "canonical",
    pool: row.pool,
    product: row.product,
  }
}

function legacyProductRow(row: any): NormalizedProductAssignment {
  return {
    id: row.id,
    productId: row.productId,
    poolId: row.poolId,
    priority: row.isDefault ? 1 : 100,
    active: true,
    isDefault: Boolean(row.isDefault),
    allowPremium: Boolean(row.allowPremium),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    source: "legacy",
    pool: row.pool,
    product: row.product,
  }
}

function canonicalNodeRow(row: any): NormalizedNodeAssignment {
  return {
    id: row.id,
    nodeId: row.nodeId,
    poolId: row.poolId,
    priority: Number(row.priority || 100),
    active: row.active !== false,
    isDefault: Number(row.priority || 100) <= 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    source: "canonical",
    pool: row.pool,
    node: row.node,
  }
}

function legacyNodeRow(row: any): NormalizedNodeAssignment {
  return {
    id: row.id,
    nodeId: row.nodeId,
    poolId: row.poolId,
    priority: row.isDefault ? 1 : 100,
    active: true,
    isDefault: Boolean(row.isDefault),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    source: "legacy",
    pool: row.pool,
    node: row.node,
  }
}

async function canonicalProductAssignments(db: DbClient, where: Prisma.PoolProductAssignmentWhereInput) {
  if (!isEnterpriseIpamEnabledByEnv()) return []
  try {
    return await db.poolProductAssignment.findMany({
      where,
      include: { pool: true, product: true },
      orderBy: [{ active: "desc" }, { priority: "asc" }, { createdAt: "asc" }],
    })
  } catch (error) {
    if (isMissingIpamSchemaError(error)) return []
    throw error
  }
}

async function canonicalNodeAssignments(db: DbClient, where: Prisma.PoolNodeAssignmentWhereInput) {
  if (!isEnterpriseIpamEnabledByEnv()) return []
  try {
    return await db.poolNodeAssignment.findMany({
      where,
      include: { pool: true, node: true },
      orderBy: [{ active: "desc" }, { priority: "asc" }, { createdAt: "asc" }],
    })
  } catch (error) {
    if (isMissingIpamSchemaError(error)) return []
    throw error
  }
}

export function normalizeProductIpPoolAssignments(input: {
  canonical?: any[]
  legacy?: any[]
}) {
  const rows = new Map<string, NormalizedProductAssignment>()
  for (const row of input.legacy || []) rows.set(row.poolId, legacyProductRow(row))
  for (const row of input.canonical || []) rows.set(row.poolId, canonicalProductRow(row))
  return sortAssignments(Array.from(rows.values()))
}

export function normalizeNodeIpPoolAssignments(input: {
  canonical?: any[]
  legacy?: any[]
}) {
  const rows = new Map<string, NormalizedNodeAssignment>()
  for (const row of input.legacy || []) rows.set(row.poolId, legacyNodeRow(row))
  for (const row of input.canonical || []) rows.set(row.poolId, canonicalNodeRow(row))
  return sortAssignments(Array.from(rows.values()))
}

export async function getProductIpPoolAssignments(productId: string, db: DbClient = prisma) {
  const [canonical, legacy] = await Promise.all([
    canonicalProductAssignments(db, { productId }),
    db.productIpPool.findMany({ where: { productId }, include: { pool: true, product: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
  ])
  return normalizeProductIpPoolAssignments({ canonical, legacy })
}

export async function getNodeIpPoolAssignments(nodeId: string, db: DbClient = prisma) {
  const [canonical, legacy] = await Promise.all([
    canonicalNodeAssignments(db, { nodeId }),
    db.nodeIpPool.findMany({ where: { nodeId }, include: { pool: true, node: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
  ])
  return normalizeNodeIpPoolAssignments({ canonical, legacy })
}

export async function getPoolProductAssignments(poolId: string, db: DbClient = prisma) {
  const [canonical, legacy] = await Promise.all([
    canonicalProductAssignments(db, { poolId }),
    db.productIpPool.findMany({ where: { poolId }, include: { pool: true, product: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
  ])
  return normalizeProductIpPoolAssignments({ canonical, legacy })
}

export async function getPoolNodeAssignments(poolId: string, db: DbClient = prisma) {
  const [canonical, legacy] = await Promise.all([
    canonicalNodeAssignments(db, { poolId }),
    db.nodeIpPool.findMany({ where: { poolId }, include: { pool: true, node: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
  ])
  return normalizeNodeIpPoolAssignments({ canonical, legacy })
}

function cleanNodeAssignments(input: unknown): NodePoolAssignmentInput[] {
  const rows = Array.isArray(input) ? input : []
  return rows
    .map((row: any) => ({
      poolId: String(row?.poolId || "").trim(),
      priority: Number.isInteger(Number(row?.priority)) ? Number(row?.priority) : row?.isDefault ? 1 : 100,
      active: row?.active !== false,
      isDefault: row?.isDefault === true,
    }))
    .filter((row) => row.poolId)
}

function cleanPoolNodeAssignments(input: unknown): PoolNodeAssignmentInput[] {
  const rows = Array.isArray(input) ? input : []
  return rows
    .map((row: any) => ({
      nodeId: String(row?.nodeId || "").trim(),
      priority: Number.isInteger(Number(row?.priority)) ? Number(row.priority) : 100,
      active: row?.active !== false,
    }))
    .filter((row) => row.nodeId && row.active !== false)
}

function cleanPoolProductAssignments(input: unknown): PoolProductAssignmentInput[] {
  const rows = Array.isArray(input) ? input : []
  return rows
    .map((row: any) => ({
      productId: String(row?.productId || "").trim(),
      priority: Number.isInteger(Number(row?.priority)) ? Number(row.priority) : 100,
      active: row?.active !== false,
    }))
    .filter((row) => row.productId && row.active !== false)
}

export function cleanProductAssignments(input: unknown): ProductPoolAssignmentInput[] {
  const rows = Array.isArray(input) ? input : []
  return rows
    .map((row: any) => ({
      poolId: String(row?.poolId || "").trim(),
      priority: Number.isInteger(Number(row?.priority)) ? Number(row?.priority) : row?.isDefault ? 1 : 100,
      active: row?.active !== false,
      isDefault: row?.isDefault === true,
    }))
    .filter((row) => row.poolId)
}

export async function serializeIpPool(poolId: string) {
  const includeBase = {
    proxmoxNode: { select: { id: true, name: true, nodeName: true } },
    allocations: {
      include: {
        node: { select: { id: true, name: true, nodeName: true } },
        vpsInstance: { include: { customer: { select: { id: true, email: true, name: true } } } },
      },
      orderBy: { ipAddress: "asc" as const },
    },
    nodeAssignments: {
      include: { node: { select: { id: true, name: true, nodeName: true, isActive: true } } },
      orderBy: [{ isDefault: "desc" as const }, { isPremiumDefault: "desc" as const }, { createdAt: "asc" as const }],
    },
    productAssignments: {
      include: { product: { select: { id: true, name: true, slug: true, premiumIpEnabled: true, isActive: true, status: true } } },
      orderBy: [{ isDefault: "desc" as const }, { allowPremium: "desc" as const }, { createdAt: "asc" as const }],
    },
    ranges: {
      where: { isActive: true },
      orderBy: { createdAt: "asc" as const },
    },
  }

  let pool: any = null
  const includeCanonical = isEnterpriseIpamEnabledByEnv()
  if (includeCanonical) {
    try {
      pool = await prisma.ipPool.findUnique({
        where: { id: poolId },
        include: {
          ...includeBase,
          poolNodeAssignments: {
            include: { node: { select: { id: true, name: true, nodeName: true, isActive: true } } },
            orderBy: [{ active: "desc" }, { priority: "asc" }, { createdAt: "asc" }],
          },
          poolProductAssignments: {
            include: { product: { select: { id: true, name: true, slug: true, premiumIpEnabled: true, isActive: true, status: true } } },
            orderBy: [{ active: "desc" }, { priority: "asc" }, { createdAt: "asc" }],
          },
        },
      })
    } catch (error) {
      if (!isMissingIpamSchemaError(error)) throw error
    }
  }

  if (!pool) {
    pool = await prisma.ipPool.findUnique({
      where: { id: poolId },
      include: includeBase,
    })
  }
  if (!pool) return null
  pool.poolNodeAssignments = await getPoolNodeAssignments(poolId)
  pool.poolProductAssignments = await getPoolProductAssignments(poolId)
  const legacyUsedIps = pool.allocations.filter((allocation: any) => ["USED", "used"].includes(String(allocation.status))).length
  const reservedIps = pool.allocations.filter((allocation: any) => ["RESERVED", "reserved"].includes(String(allocation.status))).length
  const assignedIps = pool.allocations.filter((allocation: any) => ["ASSIGNED", "assigned"].includes(String(allocation.status))).length
  const blockedIps = pool.allocations.filter((allocation: any) => ["BLOCKED", "blocked"].includes(String(allocation.status))).length
  const damagedIps = pool.allocations.filter((allocation: any) => ["DAMAGED", "damaged"].includes(String(allocation.status))).length
  const maintenanceIps = pool.allocations.filter((allocation: any) => ["MAINTENANCE", "maintenance"].includes(String(allocation.status))).length
  const freeIps = pool.allocations.filter((allocation: any) => ["FREE", "free", "RELEASED", "released"].includes(String(allocation.status))).length
  return {
    ...pool,
    totalIps: pool.allocations.length,
    usedIps: legacyUsedIps + assignedIps,
    assignedIps,
    reservedIps,
    blockedIps,
    damagedIps,
    maintenanceIps,
    freeIps,
    utilizationPercent: pool.allocations.length ? Math.round(((legacyUsedIps + assignedIps + reservedIps) / pool.allocations.length) * 100) : 0,
  }
}

export async function setNodeIpPoolAssignments(nodeId: string, rawAssignments: unknown) {
  const assignments = cleanNodeAssignments(rawAssignments)
  const poolIds = assignments.map((row) => row.poolId)
  if (poolIds.length) {
    const pools = await prisma.ipPool.findMany({ where: { id: { in: poolIds }, isActive: true, staticOnly: true }, select: { id: true } })
    if (pools.length !== new Set(poolIds).size) throw new Error("One or more selected IP pools are inactive, non-static, or missing")
  }

  return prisma.$transaction(async (tx) => {
    if (isEnterpriseIpamEnabledByEnv()) {
      try {
        await tx.poolNodeAssignment.deleteMany({ where: { nodeId, ...(poolIds.length ? { poolId: { notIn: poolIds } } : {}) } })
        for (const row of assignments) {
          await tx.poolNodeAssignment.upsert({
            where: { poolId_nodeId: { poolId: row.poolId, nodeId } },
            create: { poolId: row.poolId, nodeId, priority: Number(row.priority ?? 100), active: row.active !== false },
            update: { priority: Number(row.priority ?? 100), active: row.active !== false },
          })
        }
      } catch (error) {
        if (!isMissingIpamSchemaError(error)) throw error
        // Best effort: keep legacy assignments as source of truth when canonical tables are unavailable.
      }
    }

    return getNodeIpPoolAssignments(nodeId, tx)
  })
}

export async function setIpPoolNodeAssignments(poolId: string, rawNodeIds: unknown, priority = 100) {
  const nodeIds = Array.from(new Set((Array.isArray(rawNodeIds) ? rawNodeIds : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean)))

  if (nodeIds.length) {
    const nodes = await prisma.proxmoxNode.findMany({ where: { id: { in: nodeIds } }, select: { id: true } })
    if (nodes.length !== nodeIds.length) throw new Error("One or more selected nodes are missing")
  }

  const pool = await prisma.ipPool.findUnique({ where: { id: poolId }, select: { id: true, isActive: true, staticOnly: true } })
  if (!pool) throw new Error("IP pool not found")

  return prisma.$transaction(async (tx) => {
    if (isEnterpriseIpamEnabledByEnv()) {
      try {
        await tx.poolNodeAssignment.deleteMany({ where: { poolId, ...(nodeIds.length ? { nodeId: { notIn: nodeIds } } : {}) } })
        for (const nodeId of nodeIds) {
          await tx.poolNodeAssignment.upsert({
            where: { poolId_nodeId: { poolId, nodeId } },
            create: { poolId, nodeId, priority, active: true },
            update: { priority, active: true },
          })
        }
      } catch (error) {
        if (!isMissingIpamSchemaError(error)) throw error
        // Legacy compatibility below keeps assignment writes available during rollout.
      }
    }

    return getPoolNodeAssignments(poolId, tx)
  })
}

export async function setIpPoolAssignmentsInTransaction(tx: any, poolId: string, input: {
  nodeAssignments?: unknown
  productAssignments?: unknown
}) {
  const nodeAssignments = cleanPoolNodeAssignments(input.nodeAssignments)
  const productAssignments = cleanPoolProductAssignments(input.productAssignments)
  const nodeIds = Array.from(new Set(nodeAssignments.map((row) => row.nodeId)))
  const productIds = Array.from(new Set(productAssignments.map((row) => row.productId)))

  const pool = await tx.ipPool.findUnique({ where: { id: poolId }, select: { id: true, isActive: true, staticOnly: true } })
  if (!pool) throw new Error("IP pool not found")
  if (!pool.isActive || !pool.staticOnly) throw new Error("IP pool must be active and static-only before assignment")

  if (nodeIds.length) {
    const nodes = await tx.proxmoxNode.findMany({ where: { id: { in: nodeIds } }, select: { id: true } })
    if (nodes.length !== nodeIds.length) throw new Error("One or more selected nodes are missing")
  }
  if (productIds.length) {
    const products = await tx.product.findMany({ where: { id: { in: productIds }, deletedAt: null }, select: { id: true } })
    if (products.length !== productIds.length) throw new Error("One or more selected products are missing")
  }

  if (isEnterpriseIpamEnabledByEnv()) {
    try {
      await tx.poolNodeAssignment.deleteMany({ where: { poolId, ...(nodeIds.length ? { nodeId: { notIn: nodeIds } } : {}) } })
      for (const row of nodeAssignments) {
        await tx.poolNodeAssignment.upsert({
          where: { poolId_nodeId: { poolId, nodeId: row.nodeId } },
          create: { poolId, nodeId: row.nodeId, priority: Number(row.priority ?? 100), active: true },
          update: { priority: Number(row.priority ?? 100), active: true },
        })
      }

      await tx.poolProductAssignment.deleteMany({ where: { poolId, ...(productIds.length ? { productId: { notIn: productIds } } : {}) } })
      for (const row of productAssignments) {
        await tx.poolProductAssignment.upsert({
          where: { poolId_productId: { poolId, productId: row.productId } },
          create: { poolId, productId: row.productId, priority: Number(row.priority ?? 100), active: true },
          update: { priority: Number(row.priority ?? 100), active: true },
        })
      }
    } catch (error) {
      if (!isMissingIpamSchemaError(error)) throw error
    }
  }

  const [nodeRows, productRows] = await Promise.all([
    getPoolNodeAssignments(poolId, tx),
    getPoolProductAssignments(poolId, tx),
  ])
  return { nodeAssignments: nodeRows, productAssignments: productRows }
}

export async function setIpPoolAssignments(poolId: string, input: {
  nodeAssignments?: unknown
  productAssignments?: unknown
}) {
  return prisma.$transaction((tx) => setIpPoolAssignmentsInTransaction(tx, poolId, input), { maxWait: 3000, timeout: 10_000 })
}

export async function validateProductIpPoolAssignments(rawAssignments: unknown) {
  const assignments = cleanProductAssignments(rawAssignments)
  const poolIds = assignments.map((row) => row.poolId)
  if (poolIds.length) {
    const pools = await prisma.ipPool.findMany({ where: { id: { in: poolIds }, isActive: true, staticOnly: true }, select: { id: true } })
    if (pools.length !== new Set(poolIds).size) throw new Error("One or more selected IP pools are inactive, non-static, or missing")
  }
  return assignments
}

export async function setProductIpPoolAssignmentsInTransaction(tx: any, productId: string, rawAssignments: unknown, premiumIpEnabled?: unknown) {
  const assignments = cleanProductAssignments(rawAssignments)
  const poolIds = assignments.map((row) => row.poolId)
  if (premiumIpEnabled !== undefined) {
    await tx.product.update({ where: { id: productId }, data: { premiumIpEnabled: premiumIpEnabled === true } })
  }
  if (isEnterpriseIpamEnabledByEnv()) {
    try {
      await tx.poolProductAssignment.deleteMany({ where: { productId, ...(poolIds.length ? { poolId: { notIn: poolIds } } : {}) } })
      for (const row of assignments) {
        await tx.poolProductAssignment.upsert({
          where: { poolId_productId: { poolId: row.poolId, productId } },
          create: { poolId: row.poolId, productId, priority: Number(row.priority ?? 100), active: row.active !== false },
          update: { priority: Number(row.priority ?? 100), active: row.active !== false },
        })
      }
    } catch (error) {
      if (!isMissingIpamSchemaError(error)) throw error
      // Best effort: keep legacy assignments as source of truth when canonical tables are unavailable.
    }
  }

  return getProductIpPoolAssignments(productId, tx)
}

export async function setProductIpPoolAssignments(productId: string, rawAssignments: unknown, premiumIpEnabled?: unknown) {
  await validateProductIpPoolAssignments(rawAssignments)
  return prisma.$transaction(async (tx) => {
    return setProductIpPoolAssignmentsInTransaction(tx, productId, rawAssignments, premiumIpEnabled)
  }, { maxWait: 3000, timeout: 10_000 })
}
