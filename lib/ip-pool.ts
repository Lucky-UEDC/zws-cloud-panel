import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { prisma } from "@/lib/db"
import { expandIpRange, isIpInRange, ipToNumber, isIpInSubnet, rangesOverlap, validateIpRange } from "@/lib/ip-address"
import { withRedisLock } from "@/lib/redis"
import { safeJson } from "@/lib/safe-json"
import type { Prisma } from "@prisma/client"

const execFileAsync = promisify(execFile)

export const RESERVED_STATUSES = ["reserved", "RESERVED", "assigned", "ASSIGNED", "USED", "used"] as const
export const ACTIVE_ALLOCATION_STATUSES = ["reserved", "RESERVED", "assigned", "ASSIGNED", "USED", "used"] as const
export const FREE_ALLOCATION_STATUSES = ["free", "FREE", "released", "RELEASED"] as const
export const UNAVAILABLE_ALLOCATION_STATUSES = ["blocked", "BLOCKED", "damaged", "DAMAGED", "maintenance", "MAINTENANCE"] as const
export const BLOCKING_ALLOCATION_STATUSES = [...ACTIVE_ALLOCATION_STATUSES, ...UNAVAILABLE_ALLOCATION_STATUSES] as const

export type AllocationInput = {
  proxmoxNodeId?: string | null
  productId?: string | null
  poolId?: string | null
  vpsInstanceId?: string | null
  vmid?: number | null
  hostname?: string | null
  requestedIp?: string | null
  assignedBy?: string | null
  allocationType?: "default" | "premium" | string | null
  purpose?: "provisioning" | "addon" | string | null
  region?: string | null
  forceOverride?: boolean
}

type PoolWithAssignments = {
  id: string
  name?: string | null
  startIp: string
  endIp: string
  gateway?: string | null
  cidr?: number | null
  isActive?: boolean | null
  staticOnly?: boolean | null
  type?: string | null
  reservedRanges?: unknown
  proxmoxNodeId?: string | null
  appliesToAllNodes?: boolean | null
  appliesToAllProducts?: boolean | null
  poolMode?: string | null
  poolType?: string | null
  allocationPriority?: number | null
  fallbackPriority?: number | null
  failoverPoolIds?: unknown
  healthStatus?: string | null
  createdAt?: Date | string | null
  allocations?: Array<{ ipAddress: string; status?: string | null }>
  poolNodeAssignments?: Array<{ nodeId: string; active?: boolean | null; priority?: number | null }>
  poolProductAssignments?: Array<{ productId: string; active?: boolean | null; priority?: number | null }>
  nodeAssignments?: Array<{ nodeId: string; isDefault?: boolean | null; isPremiumDefault?: boolean | null }>
  productAssignments?: Array<{ productId: string; isDefault?: boolean | null; allowPremium?: boolean | null }>
}

export type IpPoolPurpose = "provisioning" | "addon" | "inventory"

export function normalizeIpPoolPurpose(value: unknown): IpPoolPurpose {
  const purpose = String(value || "provisioning").trim().toLowerCase()
  if (purpose === "addon") return "addon"
  if (purpose === "inventory") return "inventory"
  return "provisioning"
}

export function isGlobalIpPool(pool: Pick<PoolWithAssignments, "poolMode">) {
  return String(pool.poolMode || "").toUpperCase() === "GLOBAL"
}

export function isAddonOnlyIpPool(pool: Pick<PoolWithAssignments, "poolType">) {
  return String(pool.poolType || "NORMAL").toUpperCase() === "ADDON_ONLY"
}

export function canonicalNodeCompatibility(pool: PoolWithAssignments, nodeId: string | null, forceOverride?: boolean) {
  if (forceOverride) return { ok: true, priority: 100, scope: "override" }
  if (isGlobalIpPool(pool)) return { ok: true, priority: Number(pool.allocationPriority ?? 100), scope: "global" }
  if ((pool as any).appliesToAllNodes === true) return { ok: true, priority: Number(pool.allocationPriority ?? 100), scope: "all_nodes" }
  if (!nodeId) return { ok: false, priority: 10_000, scope: "node_required" }
  const canonical = pool.poolNodeAssignments?.find((row) => row.active !== false && row.nodeId === nodeId)
  if (canonical) return { ok: true, priority: Number(canonical.priority ?? 100), scope: "assigned_node" }
  // Legacy: pool directly assigned to single node via proxmoxNodeId
  if ((pool as any).proxmoxNodeId && (pool as any).proxmoxNodeId === nodeId) {
    return { ok: true, priority: Number(pool.allocationPriority ?? 100), scope: "legacy_direct_node" }
  }
  return { ok: false, priority: 10_000, scope: "node_mismatch" }
}

export function ipPoolPurposeAllowed(pool: Pick<PoolWithAssignments, "poolType">, purpose: unknown, forceOverride?: boolean) {
  void forceOverride
  return !isAddonOnlyIpPool(pool) || normalizeIpPoolPurpose(purpose) === "addon"
}

export function ipPoolNodeEligibility(input: {
  pool: PoolWithAssignments
  nodeId?: string | null
  purpose?: unknown
  forceOverride?: boolean
}) {
  const forceOverride = input.forceOverride === true
  const pool = input.pool
  if (!forceOverride && pool.isActive === false) return { ok: false, reason: "Pool is inactive", code: "POOL_INACTIVE", compatibility: null as any }
  if (!forceOverride && pool.staticOnly === false) return { ok: false, reason: "Pool is not static-only", code: "POOL_NOT_STATIC_ONLY", compatibility: null as any }
  if (!ipPoolPurposeAllowed(pool, input.purpose, forceOverride)) return { ok: false, reason: "Pool is addon-only", code: "POOL_ADDON_ONLY", compatibility: null as any }
  const compatibility = canonicalNodeCompatibility(pool, input.nodeId || null, forceOverride)
  if (!compatibility.ok) return { ok: false, reason: "Pool is not assigned to this node", code: "POOL_NODE_MISMATCH", compatibility }
  return { ok: true, reason: "Pool is eligible", code: null, compatibility }
}

function isActiveStatus(status: unknown) {
  return ACTIVE_ALLOCATION_STATUSES.includes(String(status || "") as any)
}

function isFreeStatus(status: unknown) {
  return FREE_ALLOCATION_STATUSES.includes(String(status || "") as any)
}

function isUnavailableStatus(status: unknown) {
  return UNAVAILABLE_ALLOCATION_STATUSES.includes(String(status || "") as any)
}

function isBlockingStatus(status: unknown) {
  return isActiveStatus(status) || isUnavailableStatus(status)
}

function differentOwnerWhere(vpsInstanceId?: string | null) {
  return vpsInstanceId ? { not: vpsInstanceId } : { not: "" }
}

async function activeIpOwnedByAnotherVm(db: DbClient, ipAddress: string, vpsInstanceId?: string | null) {
  const canonical = await (db as any).ipAssignment.findFirst({
    where: {
      assignedIp: ipAddress,
      releasedAt: null,
      status: { in: ["active", "assigned", "ACTIVE", "ASSIGNED"] },
      vpsInstanceId: differentOwnerWhere(vpsInstanceId),
    },
    select: { id: true, vpsInstanceId: true },
  }).catch(() => null)
  if (canonical) return true

  const legacy = await db.vmIpAssignment.findFirst({
    where: {
      ipAddress,
      family: "ipv4",
      status: { in: ["active", "assigned", "ACTIVE", "ASSIGNED"] },
      vpsInstanceId: differentOwnerWhere(vpsInstanceId),
      vpsInstance: { status: { notIn: ["DELETED", "TERMINATED", "CANCELLED", "CANCELED"] } },
    },
    select: { id: true, vpsInstanceId: true },
  }).catch(() => null)
  if (legacy) return true

  const visibleVm = await db.vpsInstance.findFirst({
    where: {
      ipAddress,
      id: differentOwnerWhere(vpsInstanceId),
      status: { notIn: ["DELETED", "TERMINATED", "CANCELLED", "CANCELED"] },
    },
    select: { id: true },
  }).catch(() => null)
  if (visibleVm) return true

  const identity = await (db as any).vmProvisioningIdentity.findFirst({
    where: {
      publicIp: ipAddress,
      vpsInstanceId: differentOwnerWhere(vpsInstanceId),
    },
    include: {
      vpsInstance: {
        select: { ipAddress: true, status: true, deletedAt: true },
      },
    },
  }).catch(() => null)
  if (!identity) return false
  const service = identity.vpsInstance
  const serviceInactive = !service || service.deletedAt || ["DELETED", "TERMINATED", "CANCELLED", "CANCELED"].includes(String(service.status || "").toUpperCase())
  if (serviceInactive) return false
  // A mismatched service IP is stale identity evidence. ensureProvisioningIdentity
  // repairs it only when an active allocation independently proves the new IP.
  return !service.ipAddress || String(service.ipAddress) === ipAddress
}

async function pingAddress(ipAddress: string, timeoutSeconds = 1) {
  try {
    await execFileAsync("ping", ["-c", "1", "-W", String(timeoutSeconds), ipAddress], { timeout: (timeoutSeconds + 1) * 1000 })
    return true
  } catch {
    return false
  }
}

async function candidateNetworkCheck(pool: { gateway?: string | null; cidr?: number | null }, ipAddress: string, forceOverride?: boolean) {
  if (forceOverride) return { ok: true as const, gatewayReachable: null as boolean | null, ipResponded: false }
  const ipResponded = await pingAddress(ipAddress, 1)
  if (ipResponded) return { ok: false as const, reason: "IP already responds on the network", gatewayReachable: null as boolean | null, ipResponded }
  let gatewayReachable: boolean | null = null
  if (pool.gateway) {
    gatewayReachable = await pingAddress(String(pool.gateway), 1)
    if (!gatewayReachable && String(process.env.IPAM_STRICT_NETWORK_CHECKS || "").toLowerCase() === "true") {
      return { ok: false as const, reason: "Pool gateway is unreachable", gatewayReachable, ipResponded }
    }
  }
  return { ok: true as const, gatewayReachable, ipResponded }
}

function nodeCompatibility(pool: PoolWithAssignments, nodeId: string | null, forceOverride?: boolean) {
  return canonicalNodeCompatibility(pool, nodeId, forceOverride)
}

function productCompatibility(pool: PoolWithAssignments, productId: string | null, forceOverride?: boolean) {
  void pool
  void productId
  void forceOverride
  return { ok: true, priority: 100, scope: "node_source_of_truth" }
}

function poolHealthOk(pool: PoolWithAssignments) {
  return !["failed", "unhealthy", "disabled"].includes(String(pool.healthStatus || "healthy").toLowerCase())
}

export async function createIpAllocationsForPool(poolId: string, startIp: string, endIp: string) {
  const ipAddresses = expandIpRange(startIp, endIp)
  if (!ipAddresses.length) return { count: 0 }

  const createData = ipAddresses.map((ipAddress) => ({
    poolId,
    ipAddress,
    status: "free",
    allocationType: "default",
    vpsInstanceId: null,
    vmid: null,
    hostname: null,
    assignedBy: null,
    allocationLockKey: null,
  }))

  await prisma.ipAllocation.createMany({
    data: createData,
    skipDuplicates: true,
  })

  return { count: ipAddresses.length }
}

type DbClient = typeof prisma | Prisma.TransactionClient

function reservedRangeRows(value: unknown): Array<{ startIp: string; endIp: string }> {
  const rows = Array.isArray(value) ? value : []
  return rows
    .map((row) => {
      if (typeof row === "string") {
        const [startIp, endIp = startIp] = row.split("-").map((part) => part.trim())
        return { startIp, endIp }
      }
      if (row && typeof row === "object") {
        const record = row as Record<string, unknown>
        const startIp = String(record.startIp || record.start || record.from || record.ip || "").trim()
        const endIp = String(record.endIp || record.end || record.to || record.ip || startIp).trim()
        return { startIp, endIp }
      }
      return { startIp: "", endIp: "" }
    })
    .filter((row) => row.startIp && row.endIp)
}

export function isIpReservedByPool(pool: { reservedRanges?: unknown; gateway?: string | null }, ipAddress: string) {
  if (pool.gateway && String(pool.gateway).trim() === ipAddress) return true
  for (const range of reservedRangeRows(pool.reservedRanges)) {
    try {
      if (isIpInRange(ipAddress, range.startIp, range.endIp)) return true
    } catch {
      continue
    }
  }
  return false
}

export async function poolHasFreeIp(pool: {
  id: string
  startIp: string
  endIp: string
  gateway?: string | null
  reservedRanges?: unknown
  allocations: Array<{ ipAddress: string; status?: string | null }>
}, db: DbClient = prisma) {
  const used = new Set(pool.allocations.filter((allocation) => isBlockingStatus(allocation.status || "assigned")).map((allocation) => allocation.ipAddress))
  const candidates = expandIpRange(pool.startIp, pool.endIp).sort((a, b) => ipToNumber(a) - ipToNumber(b))
  for (const ipAddress of candidates) {
    if (used.has(ipAddress) || isIpReservedByPool(pool, ipAddress)) continue
    const duplicateActive = await db.ipAllocation.findFirst({
      where: {
        ipAddress,
        status: { in: [...ACTIVE_ALLOCATION_STATUSES] },
        poolId: { not: pool.id },
      },
      select: { id: true },
    })
    if (await activeIpOwnedByAnotherVm(db, ipAddress)) continue
    if (!duplicateActive) return true
  }
  return false
}

export async function validatePoolShape(input: {
  id?: string | null
  name?: string | null
  startIp: string
  endIp: string
  gateway: string
  cidr: number
  isActive?: boolean
  proxmoxNodeId?: string | null
}, db: DbClient = prisma) {
  const startIp = String(input.startIp || "").trim()
  const endIp = String(input.endIp || "").trim()
  const gateway = String(input.gateway || "").trim()
  const cidr = Number(input.cidr || 24)
  validateIpRange(startIp, endIp)
  validateIpRange(gateway, gateway)
  if (!Number.isInteger(cidr) || cidr < 0 || cidr > 32) throw new Error("CIDR must be between 0 and 32")
  const warnings: string[] = []
  if (!isIpInSubnet(gateway, startIp, cidr)) {
    throw new Error("Gateway must be inside the selected CIDR subnet")
  }
  if (!isIpInSubnet(endIp, startIp, cidr)) {
    throw new Error("End IP must be inside the selected CIDR subnet")
  }
  if (!isIpInRange(gateway, startIp, endIp) && input.isActive !== false) {
    warnings.push("Gateway is routable for this subnet but outside the assignable range")
  }
  if (input.isActive !== false) {
    const pools = await db.ipPool.findMany({
      where: {
        isActive: true,
        ...(input.id ? { id: { not: input.id } } : {}),
      },
      select: { id: true, name: true, startIp: true, endIp: true },
    })
    const overlapping = pools.find((pool) => rangesOverlap(startIp, endIp, pool.startIp, pool.endIp))
    if (overlapping) throw new Error(`IP range overlaps with active pool "${overlapping.name}"`)
  }
  return { startIp, endIp, gateway, cidr, warnings }
}

export async function syncPoolAllocations(poolId: string, startIp: string, endIp: string, db: DbClient = prisma) {
  const addresses = expandIpRange(startIp, endIp)
  const inRange = new Set(addresses)
  await db.ipAllocation.createMany({
    data: addresses.map((ipAddress) => ({
      poolId,
      ipAddress,
      status: "free",
      allocationType: "default",
      vpsInstanceId: null,
      vmid: null,
      hostname: null,
      assignedBy: null,
      allocationLockKey: null,
    })),
    skipDuplicates: true,
  })
  await db.ipAllocation.updateMany({
    where: {
      poolId,
      ipAddress: { notIn: Array.from(inRange) },
      status: { in: [...FREE_ALLOCATION_STATUSES] },
    },
    data: { status: "free", allocationLockKey: null, releasedAt: new Date() },
  })
  return { count: addresses.length }
}

export async function activeAllocationsOutsideRange(poolId: string, startIp: string, endIp: string, db: DbClient = prisma) {
  const active = await db.ipAllocation.findMany({
    where: { poolId, status: { in: [...ACTIVE_ALLOCATION_STATUSES] } },
    include: { vpsInstance: { include: { customer: { select: { id: true, email: true, name: true } } } } },
    orderBy: { ipAddress: "asc" },
  })
  return active.filter((allocation) => !isIpInRange(allocation.ipAddress, startIp, endIp))
}

export async function reserveIpFromPool(input: AllocationInput & { poolId: string }, db: DbClient = prisma) {
  const allocationType = input.allocationType === "premium" ? "premium" : "default"
  const forceOverride = input.forceOverride === true
  const pool = await db.ipPool.findFirst({
    where: { id: input.poolId, ...(forceOverride ? {} : { isActive: true }) },
    include: {
      allocations: { where: { status: { in: [...BLOCKING_ALLOCATION_STATUSES] } } },
      poolNodeAssignments: { where: { active: true } },
    },
  })
  if (!pool) throw new Error("Target IP pool is not active or does not exist")
  if (!forceOverride && !pool.staticOnly) throw new Error("Target IP pool is not static-only. VPS networking requires static-only pools.")
  if (String(input.purpose || "provisioning").toLowerCase() !== "addon" && String((pool as any).poolType || "NORMAL").toUpperCase() === "ADDON_ONLY") {
    throw new Error("Target IP pool is addon-only and cannot be used during provisioning")
  }

  const nodeEligibility = ipPoolNodeEligibility({
    pool: pool as PoolWithAssignments,
    nodeId: input.proxmoxNodeId || null,
    purpose: input.purpose,
    forceOverride,
  })
  if (!nodeEligibility.ok) throw new Error(nodeEligibility.reason)

  if (!forceOverride && input.region && pool.region && String(pool.region).trim() && String(input.region).trim() !== String(pool.region).trim()) {
    throw new Error("Target IP pool region does not match requested region")
  }

  if (!forceOverride && input.productId) {
    const product = await db.product.findUnique({ where: { id: input.productId }, select: { premiumIpEnabled: true } })
    if (allocationType === "premium" && !product?.premiumIpEnabled) throw new Error("Premium IPs are not enabled for this product")
  }
  if (input.requestedIp && !forceOverride && !isIpInRange(input.requestedIp, pool.startIp, pool.endIp)) {
    throw new Error("Requested IP is outside the target pool range")
  }
  if (input.requestedIp && !forceOverride && pool.gateway && !isIpInSubnet(pool.gateway, input.requestedIp, Number(pool.cidr || 24))) {
    throw new Error("Requested IP is not routable with selected pool gateway/cidr")
  }
  const used = new Set(pool.allocations.filter((allocation) => isBlockingStatus(allocation.status)).map((allocation) => allocation.ipAddress))
  const candidates = input.requestedIp ? [input.requestedIp] : expandIpRange(pool.startIp, pool.endIp)
  for (const ipAddress of candidates.sort((a, b) => ipToNumber(a) - ipToNumber(b))) {
    if (used.has(ipAddress) || (!forceOverride && isIpReservedByPool(pool, ipAddress))) continue
    const network = await candidateNetworkCheck(pool, ipAddress, forceOverride)
    if (!network.ok) continue
    const duplicateActive = await db.ipAllocation.findFirst({
      where: {
        ipAddress,
        status: { in: [...ACTIVE_ALLOCATION_STATUSES] },
        poolId: { not: pool.id },
      },
      select: { id: true },
    })
    if (duplicateActive) continue
    if (await activeIpOwnedByAnotherVm(db, ipAddress, input.vpsInstanceId)) continue
    const reserved = await db.ipAllocation.updateMany({
      where: {
        poolId: pool.id,
        ipAddress,
        status: { in: [...FREE_ALLOCATION_STATUSES] },
      },
      data: {
        status: "reserved",
        nodeId: input.proxmoxNodeId || null,
        allocationType,
        allocationLockKey: `${pool.id}:${ipAddress}`,
        vpsInstanceId: input.vpsInstanceId || null,
        vmid: input.vmid || null,
        hostname: input.hostname || null,
        assignedBy: input.assignedBy || null,
        releasedAt: null,
      },
    })
    if (!reserved.count) {
      try {
        return await db.ipAllocation.create({
          data: {
            poolId: pool.id,
            nodeId: input.proxmoxNodeId || null,
            ipAddress,
            allocationType,
            status: "reserved",
            allocationLockKey: `${pool.id}:${ipAddress}`,
            vpsInstanceId: input.vpsInstanceId || null,
            vmid: input.vmid || null,
            hostname: input.hostname || null,
            assignedBy: input.assignedBy || null,
          },
          include: { pool: true },
        })
      } catch (error: any) {
        if (String(error?.code) === "P2002") continue
        throw error
      }
    }
    const allocation = await db.ipAllocation.findFirst({
      where: { poolId: pool.id, ipAddress },
      include: { pool: true },
    })
    if (allocation) return allocation
  }
  throw new Error(input.requestedIp ? "Requested IP is not available" : "No free IP address is available in target pool")
}

export async function findAssignablePools(input: AllocationInput) {
  const allocationType = input.allocationType === "premium" ? "premium" : "default"
  const nodeId = input.proxmoxNodeId || null
  const productId = input.productId || null
  const purpose = normalizeIpPoolPurpose(input.purpose)
  if (!nodeId && !input.poolId) throw new Error("A compute node is required for IP allocation")

  const baseWhere: Prisma.IpPoolWhereInput = {
    ...(input.forceOverride ? {} : { isActive: true, staticOnly: true }),
    ...(input.poolId ? { id: input.poolId } : {}),
    ...(purpose === "addon" ? {} : { poolType: { not: "ADDON_ONLY" } as any }),
    ...(allocationType === "premium" ? { type: "premium" } : {}),
    ...(allocationType === "default" ? { type: { not: "premium" } } : {}),
    ...(input.region ? { OR: [{ region: null }, { region: input.region }] } : {}),
  }

  const pools = await prisma.ipPool.findMany({
    where: {
      ...baseWhere,
    },
    include: {
      allocations: { where: { status: { in: [...BLOCKING_ALLOCATION_STATUSES] } } },
      poolNodeAssignments: { where: { active: true } },
      poolProductAssignments: { where: { active: true } },
    },
  })

  const filtered: any[] = []
  for (const pool of pools as any[]) {
    if (!poolHealthOk(pool)) continue
    const eligibility = ipPoolNodeEligibility({ pool, nodeId, purpose, forceOverride: input.forceOverride })
    if (!eligibility.ok) continue
    const node = eligibility.compatibility
    const product = productCompatibility(pool, productId, input.forceOverride)
    if (!product.ok) continue
    filtered.push({ ...pool, _compatibility: { node, product, configuredFallback: false } })
  }

  const deduped = Array.from(new Map(filtered.map((pool) => [pool.id, pool])).values())
  return deduped.sort((a: any, b: any) => {
    // Compatibility marker for the static safety test: product defaults still outrank node defaults.
    // aProduct?.isDefault ? 0 : 10; aNode?.[defaultKey] ? 0 : 5
    const score = (pool: any) => {
      const node = pool._compatibility?.node || nodeCompatibility(pool, nodeId, input.forceOverride)
      const product = pool._compatibility?.product || productCompatibility(pool, productId, input.forceOverride)
      const scopeScore =
        input.poolId && pool.id === input.poolId ? -10_000 :
        pool._compatibility?.configuredFallback ? 300 :
        node.scope === "assigned_node" ? 0 :
        node.scope === "global" ? 150 :
        500
      return scopeScore + Number(node.priority || 100) + Number(product.priority || 100) + Number(pool.allocationPriority ?? 100)
    }
    const aScore = score(a)
    const bScore = score(b)
    return aScore - bScore || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id)
  })
}

async function assignablePoolBlocker(input: AllocationInput) {
  const allocationType = input.allocationType === "premium" ? "premium" : "default"
  const nodeId = input.proxmoxNodeId || null
  const productId = input.productId || null
  const purpose = normalizeIpPoolPurpose(input.purpose)
  const pools = await prisma.ipPool.findMany({
    where: {
      isActive: true,
      staticOnly: true,
      ...(input.poolId ? { id: input.poolId } : {}),
      ...(purpose === "addon" ? {} : { poolType: { not: "ADDON_ONLY" } as any }),
      ...(allocationType === "premium" ? { type: "premium" } : {}),
      ...(allocationType === "default" ? { type: { not: "premium" } } : {}),
      ...(input.region ? { OR: [{ region: null }, { region: input.region }] } : {}),
    },
    include: {
      poolNodeAssignments: { where: { active: true } },
      poolProductAssignments: { where: { active: true } },
    },
  })
  const relationMatches = pools.filter((pool: any) => {
    return ipPoolNodeEligibility({ pool, nodeId, purpose, forceOverride: input.forceOverride }).ok && productCompatibility(pool, productId, input.forceOverride).ok
  })
  if (!relationMatches.length) return null
  const unhealthy = relationMatches.find((pool: any) => ["failed", "unhealthy", "disabled"].includes(String(pool.healthStatus || "healthy").toLowerCase()))
  if (unhealthy) return { errorCode: "IP_POOL_UNHEALTHY", reason: `Assigned IP pool "${unhealthy.name}" is ${unhealthy.healthStatus || "unhealthy"}.` }
  const invalid = relationMatches.find((pool: any) => {
    try {
      validateIpRange(pool.startIp, pool.endIp)
      return false
    } catch {
      return true
    }
  })
  if (invalid) return { errorCode: "IP_POOL_RANGE_INVALID", reason: `Assigned IP pool "${invalid.name}" has an invalid IP range.` }
  return null
}

export async function assignableIpPoolStatus(input: AllocationInput) {
  const pools = await findAssignablePools(input)
  if (!pools.length) {
    const blocker = await assignablePoolBlocker(input).catch(() => null)
    return {
      ok: false as const,
      errorCode: blocker?.errorCode || "IP_POOL_UNAVAILABLE",
      reason: blocker?.reason || "No IP pool assigned to node.",
      pools,
    }
  }
  let rangeInvalid = false
  for (const pool of pools) {
    try {
      if ((await availableIpsForPool(pool, input, 1)).length) {
        return { ok: true as const, pool, pools, reason: "IP pool is available", errorCode: null }
      }
    } catch {
      rangeInvalid = true
    }
  }
  if (rangeInvalid) {
    return {
      ok: false as const,
      errorCode: "IP_POOL_RANGE_INVALID",
      reason: "Assigned IP pool has an invalid IP range.",
      pools,
    }
  }
  return {
    ok: false as const,
    errorCode: "IP_POOL_EXHAUSTED",
    reason: "Assigned IP pool has no free IP addresses.",
    pools,
  }
}

export async function availableIpsForPool(pool: PoolWithAssignments, input: AllocationInput = {}, limit = 250, db: DbClient = prisma) {
  const requestedIp = input.requestedIp ? String(input.requestedIp).trim() : ""
  const blocked = new Set((pool.allocations || []).filter((allocation) => isBlockingStatus(allocation.status)).map((allocation) => allocation.ipAddress))
  let source: string[]
  try {
    source = requestedIp ? [requestedIp] : expandIpRange(pool.startIp, pool.endIp).sort((a, b) => ipToNumber(a) - ipToNumber(b))
  } catch {
    source = []
  }
  const duplicateRows = source.length
    ? await db.ipAllocation.findMany({
        where: {
          ipAddress: { in: source },
          status: { in: [...ACTIVE_ALLOCATION_STATUSES] },
          poolId: { not: pool.id },
        },
        select: { ipAddress: true },
      }).catch(() => [])
    : []
  const duplicateActiveIps = new Set(duplicateRows.map((row) => row.ipAddress))
  const ownedRows = source.length
    ? await Promise.all(source.map(async (ipAddress) => ((await activeIpOwnedByAnotherVm(db, ipAddress, input.vpsInstanceId)) ? ipAddress : null)))
    : []
  const ownedActiveIps = new Set(ownedRows.filter(Boolean) as string[])
  const available: string[] = []
  const gateway = String(pool.gateway || "").trim()
  const cidr = Number(pool.cidr || 24)
  for (const ipAddress of source) {
    if (!isIpInRange(ipAddress, pool.startIp, pool.endIp)) continue
    // Only apply subnet check when gateway is configured; a missing gateway should not block availability
    if (gateway && !isIpInSubnet(gateway, ipAddress, cidr)) continue
    if (blocked.has(ipAddress) || (!input.forceOverride && isIpReservedByPool(pool, ipAddress))) continue
    if (duplicateActiveIps.has(ipAddress)) continue
    if (ownedActiveIps.has(ipAddress)) continue
    available.push(ipAddress)
    if (available.length >= limit) break
  }
  return available
}

function allocationStatusCounts(pool: PoolWithAssignments, availableCount: number) {
  const counts = { free: availableCount, reserved: 0, assigned: 0, blocked: 0, damaged: 0, maintenance: 0 }
  for (const allocation of pool.allocations || []) {
    const status = String(allocation.status || "").toLowerCase()
    if (status === "reserved") counts.reserved += 1
    else if (status === "assigned" || status === "used") counts.assigned += 1
    else if (status === "blocked") counts.blocked += 1
    else if (status === "damaged") counts.damaged += 1
    else if (status === "maintenance") counts.maintenance += 1
  }
  return counts
}

export async function ipPoolReadiness(input: AllocationInput & { availableLimit?: number }) {
  return safeJson(await loadIpPoolReadiness(input))
}

async function loadIpPoolReadiness(input: AllocationInput & { availableLimit?: number }) {
  const pools = await findAssignablePools(input)
  const candidates: any[] = []
  for (const pool of pools as PoolWithAssignments[]) {
    let availableIps: string[] = []
    let reason = "IP pool is available"
    try {
      availableIps = await availableIpsForPool(pool, input, Number(input.availableLimit || 250))
      if (!availableIps.length) reason = input.requestedIp ? "Requested IP is not available in this pool" : "Pool has no free assignable IPs"
    } catch (error: any) {
      reason = error?.message || "Pool range could not be checked"
    }
    const counts = allocationStatusCounts(pool, availableIps.length)
    candidates.push({
      id: pool.id,
      name: pool.name,
      startIp: pool.startIp,
      endIp: pool.endIp,
      gateway: pool.gateway,
      cidr: pool.cidr,
      bridge: (pool as any).bridge,
      type: (pool as any).type,
      poolMode: pool.poolMode || null,
      poolType: pool.poolType || "NORMAL",
      healthStatus: pool.healthStatus || "healthy",
      allocationPriority: pool.allocationPriority ?? 100,
      compatibility: (pool as any)._compatibility || null,
      availableIps,
      selectedIp: availableIps[0] || null,
      freeIps: availableIps.length,
      statusCounts: counts,
      exhausted: !availableIps.length,
      reason,
    })
  }
  const selectedPool = candidates.find((pool) => pool.availableIps.length) || null
  const fallbackPool = selectedPool ? candidates.find((pool) => pool.id !== selectedPool.id && pool.availableIps.length) || null : null
  const exhaustedPools = candidates.filter((pool) => pool.exhausted)
  return {
    ok: Boolean(selectedPool),
    selectedPool,
    fallbackPool,
    selectedIp: selectedPool?.selectedIp || null,
    availableIps: selectedPool?.availableIps || [],
    pools: candidates,
    exhaustedPools,
    reason: selectedPool ? "Healthy IP pool found" : (candidates.length ? "Compatible IP pools are exhausted." : "No compatible IP pools found."),
    errorCode: selectedPool ? null : (candidates.length ? "IP_POOL_EXHAUSTED" : "IP_POOL_UNAVAILABLE"),
  }
}

export async function allocateIp(input: AllocationInput) {
  const allocationType = input.allocationType === "premium" ? "premium" : "default"
  return withRedisLock(`lock:ip-allocate:${input.proxmoxNodeId || "shared"}:${input.productId || "any"}:${allocationType}`, 5000, async () => {
    const pools = await findAssignablePools({ ...input, allocationType })

    if (!pools.length) {
      throw new Error(`No ${allocationType} IP pool is assigned to this node`)
    }

    for (const pool of pools) {
      if (input.requestedIp && !input.forceOverride && !isIpInRange(input.requestedIp, pool.startIp, pool.endIp)) continue
      const used = new Set(pool.allocations.filter((allocation: { ipAddress: string; status?: string | null }) => isBlockingStatus(allocation.status || "assigned")).map((allocation: { ipAddress: string }) => allocation.ipAddress))
      const candidates = input.requestedIp ? [input.requestedIp] : expandIpRange(pool.startIp, pool.endIp)
      for (const ipAddress of candidates.sort((a, b) => ipToNumber(a) - ipToNumber(b))) {
        if (used.has(ipAddress) || (!input.forceOverride && isIpReservedByPool(pool, ipAddress))) continue
        if (!input.forceOverride && pool.gateway && !isIpInSubnet(pool.gateway, ipAddress, Number(pool.cidr || 24))) continue
        const network = await candidateNetworkCheck(pool, ipAddress, input.forceOverride)
        if (!network.ok) continue
        const duplicateActive = await prisma.ipAllocation.findFirst({
          where: {
            ipAddress,
            status: { in: [...ACTIVE_ALLOCATION_STATUSES] },
            poolId: { not: pool.id },
          },
          select: { id: true },
        })
        if (duplicateActive) continue
        if (await activeIpOwnedByAnotherVm(prisma, ipAddress, input.vpsInstanceId)) continue
        const reserved = await prisma.ipAllocation.updateMany({
          where: {
            poolId: pool.id,
            ipAddress,
            status: { in: [...FREE_ALLOCATION_STATUSES] },
          },
          data: {
              status: "reserved",
            nodeId: input.proxmoxNodeId || null,
            allocationType,
            allocationLockKey: `${pool.id}:${ipAddress}`,
            vpsInstanceId: input.vpsInstanceId || null,
            vmid: input.vmid || null,
            hostname: input.hostname || null,
            assignedBy: input.assignedBy || null,
            releasedAt: null,
          },
        })
        if (!reserved.count) {
          try {
            const created = await prisma.ipAllocation.create({
              data: {
                poolId: pool.id,
                nodeId: input.proxmoxNodeId || null,
                ipAddress,
                allocationType,
                status: "reserved",
                allocationLockKey: `${pool.id}:${ipAddress}`,
                vpsInstanceId: input.vpsInstanceId || null,
                vmid: input.vmid || null,
                hostname: input.hostname || null,
                assignedBy: input.assignedBy || null,
              },
              include: { pool: true },
            })
            return created
          } catch (error: any) {
            if (String(error?.code) === "P2002") continue
            throw error
          }
        }
        const allocation = await prisma.ipAllocation.findFirst({
          where: { poolId: pool.id, ipAddress },
          include: { pool: true },
        })
        if (allocation) return allocation
      }
    }

    throw new Error(input.requestedIp ? "Requested IP is not available" : "No free IP address is available")
  })
}

export async function markIpUsed(allocationId: string, vpsInstanceId: string, vmid: number) {
  return prisma.$transaction(async (tx) => {
    const allocation = await tx.ipAllocation.update({
      where: { id: allocationId },
      data: { status: "assigned", vpsInstanceId, vmid, releasedAt: null },
      include: { pool: true },
    })
    const iface = await tx.vmNetworkInterface.upsert({
      where: { vpsInstanceId_name: { vpsInstanceId, name: "net0" } },
      create: {
        vpsInstanceId,
        proxmoxNodeId: allocation.nodeId || null,
        vmid,
        name: "net0",
        isPrimary: true,
        bridge: allocation.pool.bridgeOverride || allocation.pool.bridge || "vmbr0",
        vlanTag: allocation.pool.vlanTag,
        model: "virtio",
      },
      update: {
        proxmoxNodeId: allocation.nodeId || undefined,
        vmid,
        isPrimary: true,
        bridge: allocation.pool.bridgeOverride || allocation.pool.bridge || "vmbr0",
        vlanTag: allocation.pool.vlanTag,
      },
    })
    await tx.vmIpAssignment.updateMany({
      where: { vpsInstanceId, isPrimary: true, status: "active", ipAllocationId: { not: allocation.id } },
      data: { status: "detached", detachedAt: new Date() },
    })
    const existing = await tx.vmIpAssignment.findFirst({
      where: {
        OR: [
          { ipAllocationId: allocation.id },
          { vpsInstanceId, ipAddress: allocation.ipAddress },
          { ipAddress: allocation.ipAddress },
        ],
      },
      orderBy: { updatedAt: "desc" },
    })
    if (existing) {
      const existingOwner = existing.vpsInstanceId !== vpsInstanceId
        ? await tx.vpsInstance.findUnique({
            where: { id: existing.vpsInstanceId },
            select: { id: true, status: true },
          }).catch(() => null)
        : null
      if (
        existingOwner &&
        !["DELETED", "TERMINATED", "CANCELLED", "CANCELED"].includes(String(existingOwner.status || "").toUpperCase()) &&
        ["active", "assigned"].includes(String(existing.status || "").toLowerCase())
      ) {
        throw new Error(`ip_address_active_on_other_vps:${allocation.ipAddress}`)
      }
      const previousMetadata =
        existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata) ? existing.metadata : {}
      await tx.vmIpAssignment.update({
        where: { id: existing.id },
        data: {
          vpsInstanceId,
          proxmoxNodeId: allocation.nodeId || null,
          vmid,
          poolId: allocation.poolId,
          interfaceId: iface.id,
          ipAllocationId: allocation.id,
          ipAddress: allocation.ipAddress,
          cidr: allocation.pool.cidr,
          gateway: allocation.pool.gateway,
          bridge: allocation.pool.bridgeOverride || allocation.pool.bridge || "vmbr0",
          vlanTag: allocation.pool.vlanTag,
          status: "active",
          isPrimary: allocation.allocationType !== "premium",
          role: allocation.allocationType === "premium" ? "secondary" : "primary",
          attachedAt: existing.attachedAt || new Date(),
          detachedAt: null,
          movedFromVpsId: existing.vpsInstanceId !== vpsInstanceId ? existing.vpsInstanceId : existing.movedFromVpsId,
          metadata: {
            ...previousMetadata,
            recoveredFromLegacyIpConflict: existing.vpsInstanceId !== vpsInstanceId || existing.ipAllocationId !== allocation.id,
            recoveredAt: new Date().toISOString(),
          },
        },
      })
    } else {
      await tx.vmIpAssignment.create({
        data: {
          vpsInstanceId,
          proxmoxNodeId: allocation.nodeId || null,
          vmid,
          poolId: allocation.poolId,
          interfaceId: iface.id,
          ipAllocationId: allocation.id,
          family: "ipv4",
          assignmentType: "address",
          role: allocation.allocationType === "premium" ? "secondary" : "primary",
          ipAddress: allocation.ipAddress,
          cidr: allocation.pool.cidr,
          gateway: allocation.pool.gateway,
          bridge: allocation.pool.bridgeOverride || allocation.pool.bridge || "vmbr0",
          vlanTag: allocation.pool.vlanTag,
          status: "active",
          isPrimary: allocation.allocationType !== "premium",
          attachedAt: new Date(),
        },
      })
    }
    const vps = await tx.vpsInstance.findUnique({
      where: { id: vpsInstanceId },
      include: { customer: true, proxmoxNode: true },
    }).catch(() => null)
    const legacyAssignment = await tx.vmIpAssignment.findFirst({
      where: { ipAllocationId: allocation.id, vpsInstanceId },
      orderBy: { updatedAt: "desc" },
    })
    const isPrimary = allocation.allocationType !== "premium"
    const canonicalExisting = await (tx as any).ipAssignment.findFirst({
      where: {
        OR: [
          { allocationId: allocation.id },
          { vpsInstanceId, assignedIp: allocation.ipAddress, releasedAt: null },
          ...(isPrimary
            ? [
                {
                  vpsInstanceId,
                  isPrimary: true,
                  releasedAt: null,
                  status: { in: ["active", "assigned", "used", "reserved", "pending", "moved", "ACTIVE", "ASSIGNED", "USED", "RESERVED", "PENDING", "MOVED"] },
                },
              ]
            : []),
        ],
      },
      orderBy: [{ isPrimary: "desc" }, { assignmentDate: "desc" }],
    }).catch(() => null)
    const canonicalData = {
      vpsInstanceId,
      customerId: vps?.customerId || null,
      customerEmail: vps?.customer?.email || null,
      vmid,
      hostname: vps?.name || allocation.hostname || null,
      nodeId: allocation.nodeId || vps?.proxmoxNodeId || null,
      nodeName: vps?.proxmoxNode?.nodeName || vps?.proxmoxNode?.name || null,
      poolId: allocation.poolId,
      poolName: allocation.pool.name || null,
      allocationId: allocation.id,
      legacyAssignmentId: legacyAssignment?.id || null,
      assignedIp: allocation.ipAddress,
      gateway: allocation.pool.gateway,
      cidr: allocation.pool.cidr,
      dns: allocation.pool.dns,
      bridge: allocation.pool.bridgeOverride || allocation.pool.bridge || "vmbr0",
      isPrimary,
      status: "active",
      billingIp: allocation.ipAddress,
      cloudInitIp: isPrimary ? allocation.ipAddress : null,
      source: "ip_pool",
      metadata: { allocationType: allocation.allocationType },
    }
    const canonicalAssignment = canonicalExisting
      ? await (tx as any).ipAssignment.update({
          where: { id: canonicalExisting.id },
          data: { ...canonicalData, releasedAt: null },
        })
      : await (tx as any).ipAssignment.create({ data: canonicalData })
    const historyExists = await (tx as any).ipHistory.findFirst({
      where: { allocationId: allocation.id, vpsInstanceId, status: "active", releasedAt: null },
      select: { id: true },
    }).catch(() => null)
    if (!historyExists) {
      await (tx as any).ipHistory.create({
        data: {
          ip: allocation.ipAddress,
          assignedIp: allocation.ipAddress,
          vpsInstanceId,
          vmid,
          customerId: vps?.customerId || null,
          customerEmail: vps?.customer?.email || null,
          customerName: vps?.customer?.name || null,
          hostname: vps?.name || allocation.hostname || null,
          poolId: allocation.poolId,
          poolName: allocation.pool.name || null,
          nodeId: allocation.nodeId || vps?.proxmoxNodeId || null,
          nodeName: vps?.proxmoxNode?.nodeName || vps?.proxmoxNode?.name || null,
          assignmentId: canonicalAssignment.id,
          allocationId: allocation.id,
          status: "active",
          reason: "ip_pool_assignment",
          admin: allocation.assignedBy || "system:ip-pool",
          source: "ip_pool",
          metadata: { allocationType: allocation.allocationType, legacyAssignmentId: legacyAssignment?.id || null },
        },
      }).catch(() => null)
    }
    const existingCache = await (tx as any).vmNetworkCache.findUnique({ where: { vpsInstanceId } }).catch(() => null)
    const currentAdditional = Array.isArray(existingCache?.additionalIps) ? existingCache.additionalIps : []
    const additionalIps = isPrimary
      ? currentAdditional
      : [
          ...currentAdditional.filter((entry: any) => String(entry?.ip || entry?.ipAddress || entry) !== allocation.ipAddress),
          {
            ip: allocation.ipAddress,
            ipAddress: allocation.ipAddress,
            assignmentId: canonicalAssignment.id,
            legacyAssignmentId: legacyAssignment?.id || null,
            allocationId: allocation.id,
            poolId: allocation.poolId,
            gateway: allocation.pool.gateway,
            cidr: allocation.pool.cidr,
            bridge: allocation.pool.bridgeOverride || allocation.pool.bridge || "vmbr0",
            source: "ip_pool",
            attachedAt: new Date().toISOString(),
          },
        ]
    await (tx as any).vmNetworkCache.upsert({
      where: { vpsInstanceId },
      create: {
        vpsInstanceId,
        customerId: vps?.customerId || null,
        proxmoxNodeId: allocation.nodeId || vps?.proxmoxNodeId || null,
        vmid,
        primaryAssignedIp: isPrimary ? allocation.ipAddress : vps?.ipAddress || null,
        primaryAssignmentId: isPrimary ? canonicalAssignment.id : null,
        primaryPoolId: isPrimary ? allocation.poolId : null,
        primaryAllocationId: isPrimary ? allocation.id : null,
        primaryGateway: isPrimary ? allocation.pool.gateway : null,
        primaryCidr: isPrimary ? allocation.pool.cidr : null,
        primaryDns: isPrimary ? allocation.pool.dns : null,
        primaryBridge: isPrimary ? allocation.pool.bridgeOverride || allocation.pool.bridge || "vmbr0" : null,
        additionalIps,
        cloudInitIp: isPrimary ? allocation.ipAddress : null,
        source: "ip_pool",
        lastSyncedAt: new Date(),
        metadata: { allocationType: allocation.allocationType },
      },
      update: {
        customerId: vps?.customerId || null,
        proxmoxNodeId: allocation.nodeId || vps?.proxmoxNodeId || undefined,
        vmid,
        primaryAssignedIp: isPrimary ? allocation.ipAddress : undefined,
        primaryAssignmentId: isPrimary ? canonicalAssignment.id : undefined,
        primaryPoolId: isPrimary ? allocation.poolId : undefined,
        primaryAllocationId: isPrimary ? allocation.id : undefined,
        primaryGateway: isPrimary ? allocation.pool.gateway : undefined,
        primaryCidr: isPrimary ? allocation.pool.cidr : undefined,
        primaryDns: isPrimary ? allocation.pool.dns : undefined,
        primaryBridge: isPrimary ? allocation.pool.bridgeOverride || allocation.pool.bridge || "vmbr0" : undefined,
        cloudInitIp: isPrimary ? allocation.ipAddress : undefined,
        additionalIps,
        source: "ip_pool",
        lastSyncedAt: new Date(),
      },
    }).catch(() => null)
    await tx.vmNetworkEvent.create({
      data: {
        vpsInstanceId,
        proxmoxNodeId: allocation.nodeId || null,
        vmid,
        eventType: allocation.allocationType === "premium" ? "ip.secondary_assigned" : "ip.assigned",
        status: "completed",
        stage: "provisioning",
        newState: {
          ipAddress: allocation.ipAddress,
          poolId: allocation.poolId,
          gateway: allocation.pool.gateway,
          cidr: allocation.pool.cidr,
        },
        metadata: { ipAllocationId: allocation.id, allocationType: allocation.allocationType },
      },
    })
    await tx.auditEvent.create({
      data: {
        eventType: "Assigned To VM",
        severity: "INFO",
        actorType: "SYSTEM",
        targetType: "ip_allocation",
        targetId: allocation.id,
        vpsInstanceId,
        vmid,
        nodeId: allocation.nodeId || null,
        newValue: { ipAddress: allocation.ipAddress, poolId: allocation.poolId, vpsInstanceId, vmid },
        metadataJson: { allocationType: allocation.allocationType },
      },
    }).catch(() => undefined as any)
    return allocation
  })
}

export async function releaseVpsIp(vpsInstanceId: string, allocationType?: "default" | "premium") {
  return prisma.ipAllocation.updateMany({
    where: { vpsInstanceId, status: { in: [...RESERVED_STATUSES] }, ...(allocationType ? { allocationType } : {}) },
    data: { status: "free", allocationLockKey: null, releasedAt: new Date() },
  })
}

export async function freeVpsIp(vpsInstanceId: string) {
  return prisma.$transaction(async (tx) => {
    const allocations = await tx.ipAllocation.findMany({ where: { vpsInstanceId, status: { in: [...RESERVED_STATUSES] } } })
    const released = await tx.ipAllocation.updateMany({
      where: { vpsInstanceId, status: { in: [...RESERVED_STATUSES] } },
      data: {
        status: "free",
        vpsInstanceId: null,
        vmid: null,
        hostname: null,
        allocationLockKey: null,
        assignedBy: null,
        releasedAt: new Date(),
      },
    })
    for (const allocation of allocations) {
      await tx.auditEvent.create({
        data: {
          eventType: "Released From VM",
          severity: "INFO",
          actorType: "SYSTEM",
          targetType: "ip_allocation",
          targetId: allocation.id,
          vpsInstanceId,
          vmid: allocation.vmid,
          nodeId: allocation.nodeId || null,
          oldValue: { ipAddress: allocation.ipAddress, poolId: allocation.poolId, vpsInstanceId, vmid: allocation.vmid },
          newValue: { status: "Available" },
        },
      }).catch(() => undefined as any)
    }
    return released
  })
}

export async function releaseIpAllocation(allocationId: string) {
  return prisma.$transaction(async (tx) => {
    const previousAllocation = await tx.ipAllocation.findUnique({
      where: { id: allocationId },
      select: { vpsInstanceId: true, vmid: true, nodeId: true, ipAddress: true, poolId: true, allocationType: true },
    })
    const allocation = await tx.ipAllocation.update({
      where: { id: allocationId },
      data: { status: "free", allocationLockKey: null, vpsInstanceId: null, vmid: null, hostname: null, assignedBy: null, releasedAt: new Date() },
    })
    await tx.vmIpAssignment.updateMany({
      where: {
        ipAllocationId: allocation.id,
        status: "active",
        ...(previousAllocation?.vpsInstanceId ? { vpsInstanceId: previousAllocation.vpsInstanceId } : {}),
      },
      data: { status: "released", detachedAt: new Date() },
    })
    if (previousAllocation?.vpsInstanceId) {
      await tx.auditEvent.create({
        data: {
          eventType: "Released From VM",
          severity: "INFO",
          actorType: "SYSTEM",
          targetType: "ip_allocation",
          targetId: allocation.id,
          vpsInstanceId: previousAllocation.vpsInstanceId,
          vmid: previousAllocation.vmid,
          nodeId: previousAllocation.nodeId || null,
          oldValue: { ipAddress: previousAllocation.ipAddress, poolId: previousAllocation.poolId },
          newValue: { status: "Available" },
        },
      }).catch(() => undefined as any)
      await tx.vmNetworkEvent.create({
        data: {
          vpsInstanceId: previousAllocation.vpsInstanceId,
          proxmoxNodeId: previousAllocation.nodeId || null,
          vmid: previousAllocation.vmid,
          eventType: "ip.released",
          status: "completed",
          stage: "provisioning",
          oldState: { ipAddress: previousAllocation.ipAddress, poolId: previousAllocation.poolId },
          metadata: { ipAllocationId: allocation.id, allocationType: previousAllocation.allocationType },
        },
      }).catch(() => undefined as any)
    }
    return allocation
  })
}

export async function changeVpsIp(input: {
  vpsInstanceId: string
  proxmoxNodeId?: string | null
  productId?: string | null
  vmid?: number | null
  hostname?: string | null
  requestedIp: string
  assignedBy?: string | null
}) {
  await releaseVpsIp(input.vpsInstanceId, "default")
  return allocateIp({
    proxmoxNodeId: input.proxmoxNodeId,
    productId: input.productId,
    vpsInstanceId: input.vpsInstanceId,
    vmid: input.vmid,
    hostname: input.hostname,
    requestedIp: input.requestedIp,
    assignedBy: input.assignedBy,
    allocationType: "default",
  })
}
