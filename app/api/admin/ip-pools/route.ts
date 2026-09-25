import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { expandIpRange, ipToNumber, isIpInSubnet, isValidIpv4, numberToIp } from "@/lib/ip-address"
import { availableIpsForPool, ipPoolNodeEligibility, isIpReservedByPool, normalizeIpPoolPurpose, syncPoolAllocations, validatePoolShape } from "@/lib/ip-pool"
import { setIpPoolNodeAssignments } from "@/lib/ipam-admin"
import { createAuditLog } from "@/lib/audit-log"
import { createPanelLog } from "@/lib/panel-log"
import { getAdminFromCookies } from "@/lib/server-auth"
import { isEnterpriseIpamEnabledByEnv } from "@/lib/startup-schema-check"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { requireAdminFullAuth } from "@/lib/auth/guards"

async function requireAdminFromCookies() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return null
  return admin
}

function normalizePoolMode(value: unknown) {
  const mode = String(value || "").trim().toUpperCase()
  return ["GLOBAL", "NODE_RESTRICTED", "PRODUCT_RESTRICTED", "HYBRID"].includes(mode) ? mode : "NODE_RESTRICTED"
}

function normalizePoolType(value: unknown) {
  const type = String(value || "").trim().toUpperCase()
  return type === "ADDON_ONLY" ? "ADDON_ONLY" : "NORMAL"
}

function normalizeImportIps(body: any) {
  const raw = Array.isArray(body.ipAddresses) ? body.ipAddresses : Array.isArray(body.ips) ? body.ips : [body.ipAddress || body.ip]
  const seen = new Set<string>()
  return raw
    .flatMap((value: unknown) => String(value || "").split(/[\s,]+/g))
    .map((value: string) => value.trim())
    .filter((value: string) => value && !seen.has(value) && seen.add(value))
}

function subnet24ForIp(ipAddress: string) {
  const network = ipToNumber(ipAddress) & 0xffffff00
  return {
    networkIp: numberToIp(network),
    startIp: numberToIp(network + 1),
    endIp: numberToIp(network + 254),
    cidr: 24,
  }
}

function defaultGatewayForImport(subnet: ReturnType<typeof subnet24ForIp>, importedIps: string[], requestedGateway?: string) {
  const gateway = String(requestedGateway || "").trim()
  if (gateway && isValidIpv4(gateway)) return gateway
  return importedIps.includes(subnet.startIp) ? subnet.endIp : subnet.startIp
}

async function ipAlreadyAssigned(ipAddress: string, tx: any) {
  const ipAssignmentClient = tx.ipAssignment
  const [canonical, legacy, vm] = await Promise.all([
    ipAssignmentClient ? ipAssignmentClient.findFirst({
      where: { assignedIp: ipAddress, releasedAt: null, status: { in: ["active", "assigned", "ACTIVE", "ASSIGNED"] } },
      select: { id: true },
    }).catch(() => null) : Promise.resolve(null),
    tx.vmIpAssignment.findFirst({
      where: { ipAddress, family: "ipv4", status: { in: ["active", "assigned", "ACTIVE", "ASSIGNED"] } },
      select: { id: true },
    }).catch(() => null),
    tx.vpsInstance.findFirst({
      where: { ipAddress, status: { notIn: ["DELETED", "TERMINATED", "CANCELLED", "CANCELED"] } },
      select: { id: true },
    }).catch(() => null),
  ])
  return Boolean(canonical || legacy || vm)
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminFullAuth(request)
  if (!auth.ok) return auth.response
  const admin = { email: auth.session.email, role: auth.session.role }
  if (!admin.email || !canAccessAdminApi(admin.role)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const purpose = normalizeIpPoolPurpose(request.nextUrl.searchParams.get("purpose") || "inventory")
  const nodeId = String(request.nextUrl.searchParams.get("nodeId") || "").trim() || null

  const baseInclude = {
    proxmoxNode: { select: { id: true, name: true, nodeName: true } },
    nodeAssignments: { include: { node: { select: { id: true, name: true, nodeName: true } } } },
    productAssignments: { include: { product: { select: { id: true, name: true, slug: true, premiumIpEnabled: true } } } },
    allocations: {
      include: {
        node: { select: { id: true, name: true, nodeName: true } },
        vpsInstance: {
          select: {
            id: true,
            name: true,
            vmid: true,
            ipAddress: true,
            proxmoxNodeId: true,
            proxmoxNode: { select: { id: true, name: true, nodeName: true } },
            customer: { select: { id: true, name: true, email: true } },
            order: { select: { id: true, orderNumber: true } },
          },
        },
      },
    },
    vmIpAssignments: {
      where: { status: { in: ["active", "ACTIVE", "assigned", "ASSIGNED"] as any } },
      include: {
        proxmoxNode: { select: { id: true, name: true, nodeName: true } },
        vpsInstance: {
          select: {
            id: true,
            name: true,
            vmid: true,
            ipAddress: true,
            proxmoxNodeId: true,
            proxmoxNode: { select: { id: true, name: true, nodeName: true } },
            customer: { select: { id: true, name: true, email: true } },
            order: { select: { id: true, orderNumber: true } },
          },
        },
      },
    },
  }
  let pools: any[] = []
  if (isEnterpriseIpamEnabledByEnv()) {
    pools = await prisma.ipPool.findMany({
      include: {
        ...baseInclude,
        poolNodeAssignments: { where: { active: true }, select: { id: true, poolId: true, nodeId: true, priority: true, active: true } },
        poolProductAssignments: { where: { active: true }, select: { id: true, poolId: true, productId: true, priority: true, active: true } },
      },
      orderBy: { createdAt: "desc" },
    }).catch(() => [])
  }
  if (!pools.length) {
    pools = await prisma.ipPool.findMany({
      include: baseInclude,
      orderBy: { createdAt: "desc" },
    })
  }
  const activeVmIps = new Set<string>()
  for (const pool of pools) {
    for (const assignment of pool.vmIpAssignments || []) {
      if (assignment.ipAddress) activeVmIps.add(String(assignment.ipAddress))
      if (assignment.vpsInstance?.ipAddress) activeVmIps.add(String(assignment.vpsInstance.ipAddress))
    }
  }
  const canonicalActiveAssignments = await ((prisma as any).ipAssignment?.findMany({
    where: { releasedAt: null, status: { in: ["active", "assigned", "ACTIVE", "ASSIGNED"] } },
    select: { assignedIp: true },
  }) || Promise.resolve([])).catch(() => [])
  for (const assignment of canonicalActiveAssignments) {
    if (assignment.assignedIp) activeVmIps.add(String(assignment.assignedIp))
  }

  const assignedStatuses = new Set(["USED", "used", "ASSIGNED", "assigned"])
  const freeStatuses = new Set(["FREE", "free", "RELEASED", "released"])

  function nodeName(...sources: any[]) {
    for (const source of sources) {
      const value = source?.nodeName || source?.name
      if (value) return value
    }
    return null
  }

  function customerName(customer: any) {
    return customer?.name || customer?.email || null
  }

  function serializeInventoryRow(pool: any, allocation: any, assignment?: any) {
    const allocationStatus = String(allocation?.status || "")
    const allocationOwnsVm = allocation && !freeStatuses.has(allocationStatus) && Boolean(allocation.vpsInstanceId)
    const vm = assignment?.vpsInstance || (allocationOwnsVm ? allocation?.vpsInstance : null) || null
    const node = assignment?.proxmoxNode || (allocationOwnsVm ? allocation?.node : null) || vm?.proxmoxNode || pool.proxmoxNode || null
    const ipAddress = assignment?.ipAddress || allocation?.ipAddress || vm?.ipAddress || null
    const assignedDate = assignment?.attachedAt || allocation?.createdAt || assignment?.createdAt || null
    const lastChanged = assignment?.updatedAt || allocation?.updatedAt || vm?.updatedAt || null
    return {
      id: allocation?.id || assignment?.id || `${pool.id}:${ipAddress}`,
      ipAddress,
      status: assignment?.status || allocation?.status || "assigned",
      datacenter: pool.region || pool.regionTag || null,
      poolId: pool.id,
      poolName: pool.name,
      nodeName: nodeName(node),
      nodeId: assignment?.proxmoxNodeId || (allocationOwnsVm ? allocation?.nodeId : null) || vm?.proxmoxNodeId || pool.proxmoxNodeId || null,
      vmid: assignment?.vmid || (allocationOwnsVm ? allocation?.vmid : null) || vm?.vmid || null,
      hostname: vm?.name || null,
      customer: customerName(vm?.customer),
      customerRecord: vm?.customer || null,
      order: vm?.order || null,
      vpsInstanceId: assignment?.vpsInstanceId || (allocationOwnsVm ? allocation?.vpsInstanceId : null) || vm?.id || null,
      assignedDate,
      lastChanged,
      createdAt: allocation?.createdAt || assignment?.createdAt || null,
      updatedAt: allocation?.updatedAt || assignment?.updatedAt || null,
    }
  }

  function purposeEligibility(pool: any) {
    if (purpose === "inventory") return { ok: true, compatibility: null as any, code: null, reason: "Inventory view" }
    if (nodeId) return ipPoolNodeEligibility({ pool, nodeId, purpose })
    if (pool.isActive === false) return { ok: false, compatibility: null as any, code: "POOL_INACTIVE", reason: "Pool is inactive" }
    if (pool.staticOnly === false) return { ok: false, compatibility: null as any, code: "POOL_NOT_STATIC_ONLY", reason: "Pool is not static-only" }
    if (String(pool.poolType || "NORMAL").toUpperCase() === "ADDON_ONLY" && purpose !== "addon") {
      return { ok: false, compatibility: null as any, code: "POOL_ADDON_ONLY", reason: "Pool is addon-only" }
    }
    return { ok: true, compatibility: null as any, code: null, reason: "Node not selected" }
  }

  const serializedPools = (await Promise.all(pools.map(async (pool: any) => {
    const eligibility = purposeEligibility(pool)
    if (!eligibility.ok) return null
    const expanded = expandIpRange(pool.startIp, pool.endIp).length
    // For the detail/provisioning view, compute live available IPs with full checks
    const liveAvailableIps = await availableIpsForPool(pool, { proxmoxNodeId: nodeId, purpose }, 1000).catch(() => [])
    const liveAvailableSet = new Set(liveAvailableIps)
    const usedIps = pool.allocations.filter((allocation: any) => assignedStatuses.has(String(allocation.status)) || activeVmIps.has(String(allocation.ipAddress))).length
    const reservedIps = pool.allocations.filter((allocation: any) => ["RESERVED", "reserved"].includes(String(allocation.status))).length
    const blockedIps = pool.allocations.filter((allocation: any) => ["BLOCKED", "blocked"].includes(String(allocation.status))).length
    const damagedIps = pool.allocations.filter((allocation: any) => ["DAMAGED", "damaged"].includes(String(allocation.status))).length
    const maintenanceIps = pool.allocations.filter((allocation: any) => ["MAINTENANCE", "maintenance"].includes(String(allocation.status))).length
    // Display count: IPs with free/released status in DB + IPs in range with no allocation record at all.
    // This is more reliable than availableIpsForPool for UI display since that function can return 0
    // when stale canonical ipAssignment records haven't been released yet.
    const trackedIps = new Set(pool.allocations.map((a: any) => String(a.ipAddress)))
    const freeByRecord = pool.allocations.filter((a: any) => ["free", "FREE", "released", "RELEASED"].includes(String(a.status || ""))).length
    let freeNoRecord = 0
    try {
      freeNoRecord = expandIpRange(pool.startIp, pool.endIp)
        .filter((ip) => !trackedIps.has(ip) && !isIpReservedByPool(pool, ip)).length
    } catch {}
    const freeIps = freeByRecord + freeNoRecord

    const hasDuplicate = new Set(
      pool.allocations
        .filter((allocation: any) => ["USED", "used", "ASSIGNED", "assigned", "RESERVED", "reserved"].includes(String(allocation.status)) || activeVmIps.has(String(allocation.ipAddress)))
        .map((allocation: any) => allocation.ipAddress),
    ).size < (usedIps + reservedIps)

    return {
      ...pool,
      nodeAssignments: pool.poolNodeAssignments || [],
      productAssignments: pool.poolProductAssignments || [],
      allowedNodes: pool.poolNodeAssignments || [],
      allowedProducts: pool.poolProductAssignments || [],
      eligibility,
      addresses: pool.allocations || [],
      totalIps: Math.max(expanded, pool.allocations.length),
      freeIps,
      usedIps,
      reservedIps,
      blockedIps,
      damagedIps,
      maintenanceIps,
      exhaustionDetected: freeIps === 0 && (usedIps + reservedIps) > 0,
      duplicateIpsDetected: hasDuplicate || Boolean(pool.duplicateIpsDetected),
      status: pool.isActive ? "ACTIVE" : "INACTIVE",
      // Build from the authoritative live-available list, not from existing allocation rows -
      // most free IPs in a pool have no IpAllocation row at all until they're first assigned.
      availableIps: liveAvailableIps.map((ipAddress: string) => {
        const allocation = pool.allocations.find((a: any) => String(a.ipAddress) === ipAddress)
        return { id: allocation?.id || null, poolId: pool.id, poolName: pool.name, ipAddress, status: "Available", node: allocation?.node || pool.proxmoxNode || null }
      }),
    }
  }))).filter(Boolean)

  const allocations = pools.flatMap((pool: any) => {
    const assignmentsByAllocation = new Map<string, any>()
    const assignmentsByIp = new Map<string, any>()
    for (const assignment of pool.vmIpAssignments || []) {
      if (assignment.ipAllocationId) assignmentsByAllocation.set(assignment.ipAllocationId, assignment)
      if (assignment.ipAddress) assignmentsByIp.set(String(assignment.ipAddress), assignment)
    }
    const rows = (pool.allocations || []).map((allocation: any) =>
      serializeInventoryRow(pool, allocation, assignmentsByAllocation.get(allocation.id) || assignmentsByIp.get(String(allocation.ipAddress))),
    )
    const existingIps = new Set(rows.map((row: any) => String(row.ipAddress)))
    for (const assignment of pool.vmIpAssignments || []) {
      if (assignment.ipAddress && !existingIps.has(String(assignment.ipAddress))) rows.push(serializeInventoryRow(pool, null, assignment))
    }
    return rows
  })

  return NextResponse.json({
    success: true,
    pools: serializedPools,
    allocations,
  })
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminFromCookies()
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

  try {
    const body = await request.json()
    const action = String(body.action || "").trim().toLowerCase()
    const importIps = normalizeImportIps(body)
    if (["import", "import-ip", "import-ips", "add-ip"].includes(action) || (importIps.length > 0 && !body.startIp && !body.endIp)) {
      if (!importIps.length) return NextResponse.json({ success: false, error: "At least one IPv4 address is required." }, { status: 400 })
      const invalid = importIps.find((ipAddress: string) => !isValidIpv4(ipAddress))
      if (invalid) return NextResponse.json({ success: false, error: `${invalid} is not a valid IPv4 address.` }, { status: 400 })

      const result = await prisma.$transaction(async (tx) => {
        const imported: any[] = []
        const poolsCreated: any[] = []
        const poolsUsed = new Map<string, any>()

        for (const ipAddress of importIps) {
          const subnet = subnet24ForIp(ipAddress)
          let pool = await tx.ipPool.findFirst({
            where: {
              isActive: true,
              cidr: 24,
              OR: [
                { startIp: subnet.startIp, endIp: subnet.endIp },
                { startIp: subnet.networkIp },
              ],
            },
          })
          if (!pool) {
            const candidatePools = await tx.ipPool.findMany({ where: { isActive: true, cidr: 24 } })
            pool = candidatePools.find((candidate: any) => {
              try {
                return isIpInSubnet(ipAddress, candidate.startIp, 24)
              } catch {
                return false
              }
            }) || null
          }
          if (!pool) {
            const gateway = defaultGatewayForImport(subnet, importIps, body.gateway)
            pool = await tx.ipPool.create({
              data: {
                name: String(body.name || `${subnet.networkIp}/24`).trim(),
                proxmoxNodeId: body.proxmoxNodeId || null,
                poolMode: normalizePoolMode(body.poolMode) as any,
                type: ["public", "private", "premium"].includes(String(body.type || "")) ? String(body.type) : "public",
                poolType: normalizePoolType(body.poolType),
                pricePerIp: Number(body.pricePerIp || 0),
                bulkEnabled: Boolean(body.bulkEnabled),
                startIp: subnet.startIp,
                endIp: subnet.endIp,
                gateway,
                cidr: 24,
                dns: String(body.dns || "1.1.1.1").trim(),
                searchDomain: body.searchDomain ? String(body.searchDomain).trim() : null,
                bridge: String(body.bridge || "vmbr0").trim(),
                reservedRanges: Array.isArray(body.reservedRanges) ? body.reservedRanges : [],
                floatingRanges: Array.isArray(body.floatingRanges) ? body.floatingRanges : [],
                failoverRanges: Array.isArray(body.failoverRanges) ? body.failoverRanges : [],
                vlanTag: body.vlanTag !== undefined && body.vlanTag !== null && String(body.vlanTag) !== "" ? Number(body.vlanTag) : null,
                bridgeOverride: body.bridgeOverride ? String(body.bridgeOverride).trim() : null,
                regionTag: body.regionTag ? String(body.regionTag).trim() : null,
                region: body.region ? String(body.region).trim() : (body.regionTag ? String(body.regionTag).trim() : null),
                allocationPriority: Number.isInteger(Number(body.allocationPriority)) ? Number(body.allocationPriority) : 100,
                fallbackPriority: Number.isInteger(Number(body.fallbackPriority)) ? Number(body.fallbackPriority) : 100,
                appliesToAllNodes: body.appliesToAllNodes === true,
                appliesToAllProducts: body.appliesToAllProducts === true,
                staticOnly: body.staticOnly !== false,
                failoverPoolIds: Array.isArray(body.failoverPoolIds) ? body.failoverPoolIds.map((id: unknown) => String(id || "").trim()).filter(Boolean) : [],
                healthStatus: body.healthStatus ? String(body.healthStatus).trim() : "healthy",
                isActive: body.isActive !== false,
                notes: body.notes ? String(body.notes) : null,
              },
            })
            poolsCreated.push(pool)
          }

          if (isIpReservedByPool(pool, ipAddress)) throw new Error(`${ipAddress} is reserved by pool ${pool.name}.`)
          const duplicate = await tx.ipAllocation.findFirst({ where: { ipAddress, poolId: { not: pool.id } }, select: { id: true, poolId: true } })
          if (duplicate) throw new Error(`${ipAddress} already exists in another pool.`)
          if (await ipAlreadyAssigned(ipAddress, tx)) throw new Error(`${ipAddress} is already assigned to a VM.`)

          const existing = await tx.ipAllocation.findUnique({ where: { poolId_ipAddress: { poolId: pool.id, ipAddress } } })
          if (existing && !["free", "FREE", "released", "RELEASED"].includes(String(existing.status))) {
            throw new Error(`${ipAddress} already exists in pool ${pool.name} with status ${existing.status}.`)
          }
          const allocation = existing || await tx.ipAllocation.create({
            data: {
              poolId: pool.id,
              ipAddress,
              status: "free",
              allocationType: "default",
            },
          })
          imported.push({ ipAddress, poolId: pool.id, poolName: pool.name, allocationId: allocation.id, reused: Boolean(existing) })
          poolsUsed.set(pool.id, pool)
        }

        return { imported, poolsCreated, poolsUsed: Array.from(poolsUsed.values()) }
      })

      if (Array.isArray(body.assignedNodeIds)) {
        for (const pool of result.poolsCreated) {
          await setIpPoolNodeAssignments(pool.id, body.assignedNodeIds, Number(body.allocationPriority || 100))
        }
      }

      await createPanelLog({
        category: "IP Pool",
        message: "IP addresses imported",
        actorType: "admin",
        actorEmail: String(admin.email),
        metadata: { imported: result.imported, poolsCreated: result.poolsCreated.map((pool: any) => pool.id) },
      }).catch(() => null)

      return NextResponse.json({ success: true, ...result })
    }

    const startIp = String(body.startIp || "").trim()
    const endIp = String(body.endIp || "").trim()
    const ips = expandIpRange(startIp, endIp)
    const validation = await validatePoolShape({
      startIp,
      endIp,
      gateway: String(body.gateway || "").trim(),
      cidr: Number(body.cidr || 24),
      isActive: body.isActive !== false,
      proxmoxNodeId: body.proxmoxNodeId || null,
    })
    const pool = await prisma.$transaction(async (tx) => {
      const createdPool = await tx.ipPool.create({
        data: {
          name: String(body.name || `${body.startIp}-${body.endIp}`).trim(),
          proxmoxNodeId: body.proxmoxNodeId || null,
          poolMode: normalizePoolMode(body.poolMode) as any,
          type: ["public", "private", "premium"].includes(String(body.type || "")) ? String(body.type) : "public",
          poolType: normalizePoolType(body.poolType),
          pricePerIp: Number(body.pricePerIp || 0),
          bulkEnabled: Boolean(body.bulkEnabled),
          startIp: validation.startIp,
          endIp: validation.endIp,
          gateway: validation.gateway,
          cidr: validation.cidr,
          dns: String(body.dns || "1.1.1.1").trim(),
          searchDomain: body.searchDomain ? String(body.searchDomain).trim() : null,
          bridge: String(body.bridge || "vmbr0").trim(),
          reservedRanges: Array.isArray(body.reservedRanges) ? body.reservedRanges : [],
          floatingRanges: Array.isArray(body.floatingRanges) ? body.floatingRanges : [],
          failoverRanges: Array.isArray(body.failoverRanges) ? body.failoverRanges : [],
          vlanTag: body.vlanTag !== undefined && body.vlanTag !== null && String(body.vlanTag) !== "" ? Number(body.vlanTag) : null,
          bridgeOverride: body.bridgeOverride ? String(body.bridgeOverride).trim() : null,
          regionTag: body.regionTag ? String(body.regionTag).trim() : null,
          region: body.region ? String(body.region).trim() : (body.regionTag ? String(body.regionTag).trim() : null),
          allocationPriority: Number.isInteger(Number(body.allocationPriority)) ? Number(body.allocationPriority) : 100,
          fallbackPriority: Number.isInteger(Number(body.fallbackPriority)) ? Number(body.fallbackPriority) : 100,
          appliesToAllNodes: body.appliesToAllNodes === true,
          appliesToAllProducts: body.appliesToAllProducts === true,
          staticOnly: body.staticOnly !== false,
          failoverPoolIds: Array.isArray(body.failoverPoolIds) ? body.failoverPoolIds.map((id: unknown) => String(id || "").trim()).filter(Boolean) : [],
          healthStatus: body.healthStatus ? String(body.healthStatus).trim() : "healthy",
          isActive: body.isActive !== false,
          notes: body.notes ? String(body.notes) : null,
        },
      })
      await syncPoolAllocations(createdPool.id, validation.startIp, validation.endIp, tx)
      return createdPool
    })
    const adminRow = await prisma.adminProfile.findUnique({ where: { email: String(admin.email).toLowerCase() }, select: { id: true } })
    if (Array.isArray(body.assignedNodeIds)) {
      await setIpPoolNodeAssignments(pool.id, body.assignedNodeIds, Number(body.allocationPriority || 100))
    }
    if (adminRow) {
      await createAuditLog({
        adminId: adminRow.id,
        action: "ip_pool.create",
        newValue: { poolId: pool.id, name: pool.name, startIp: pool.startIp, endIp: pool.endIp },
        userAgent: request.headers.get("user-agent"),
      })
    }
    await createPanelLog({
      category: "IP Pool",
      message: "IP pool created",
      actorType: "admin",
      actorEmail: String(admin.email),
      metadata: { poolId: pool.id, name: pool.name, range: `${pool.startIp}-${pool.endIp}`, warnings: validation.warnings },
    })
    return NextResponse.json({
      success: true,
      pool,
      warnings: validation.warnings,
      createdIpRecords: ips.length,
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || "Failed to create IP pool" }, { status: 400 })
  }
}
