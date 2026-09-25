import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { activeAllocationsOutsideRange, syncPoolAllocations, validatePoolShape } from "@/lib/ip-pool"
import { getPoolProductAssignments, serializeIpPool, setIpPoolNodeAssignments } from "@/lib/ipam-admin"
import { createAuditLog } from "@/lib/audit-log"
import { createPanelLog } from "@/lib/panel-log"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { recoverIpBlockedProvisioning } from "@/lib/provisioning-ipam-recovery"

async function requireAdmin() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return null
  return admin
}

function normalizePoolMode(value: unknown, fallback: string) {
  const mode = String(value || "").trim().toUpperCase()
  return ["GLOBAL", "NODE_RESTRICTED", "PRODUCT_RESTRICTED", "HYBRID"].includes(mode) ? mode : fallback
}

function normalizePoolType(value: unknown, fallback: string) {
  const type = String(value || fallback || "").trim().toUpperCase()
  return type === "ADDON_ONLY" ? "ADDON_ONLY" : "NORMAL"
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const pool = await serializeIpPool(id)
  if (!pool) return NextResponse.json({ success: false, error: "IP pool not found" }, { status: 404 })
  const [nodes, products, pools] = await Promise.all([
    prisma.proxmoxNode.findMany({ select: { id: true, name: true, nodeName: true, isActive: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where: { category: "vps" }, select: { id: true, name: true, slug: true, premiumIpEnabled: true, isActive: true, status: true }, orderBy: { name: "asc" } }),
    prisma.ipPool.findMany({ where: { id: { not: id }, isActive: true }, select: { id: true, name: true, startIp: true, endIp: true, cidr: true, type: true }, orderBy: { name: "asc" } }),
  ])
  return NextResponse.json({ success: true, pool, nodes, products, targetPools: pools })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  try {
    const body = await request.json()
    const existing = await prisma.ipPool.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ success: false, error: "IP pool not found" }, { status: 404 })
    const next = {
      name: body.name === undefined ? existing.name : String(body.name).trim(),
      proxmoxNodeId: body.proxmoxNodeId === undefined ? existing.proxmoxNodeId : body.proxmoxNodeId || null,
      poolMode: body.poolMode === undefined ? (existing as any).poolMode || "NODE_RESTRICTED" : normalizePoolMode(body.poolMode, (existing as any).poolMode || "NODE_RESTRICTED"),
      type: body.type === undefined ? existing.type : ["public", "private", "premium"].includes(String(body.type || "")) ? String(body.type) : existing.type,
      poolType: body.poolType === undefined ? (existing as any).poolType || "NORMAL" : normalizePoolType(body.poolType, (existing as any).poolType || "NORMAL"),
      pricePerIp: body.pricePerIp === undefined ? existing.pricePerIp : Number(body.pricePerIp || 0),
      bulkEnabled: body.bulkEnabled === undefined ? existing.bulkEnabled : Boolean(body.bulkEnabled),
      startIp: body.startIp === undefined ? existing.startIp : String(body.startIp).trim(),
      endIp: body.endIp === undefined ? existing.endIp : String(body.endIp).trim(),
      gateway: body.gateway === undefined ? existing.gateway : String(body.gateway).trim(),
      cidr: body.cidr === undefined ? existing.cidr : Number(body.cidr),
      dns: body.dns === undefined ? existing.dns : String(body.dns).trim(),
      searchDomain: body.searchDomain === undefined ? existing.searchDomain : body.searchDomain ? String(body.searchDomain).trim() : null,
      bridge: body.bridge === undefined ? existing.bridge : String(body.bridge).trim(),
      reservedRanges: body.reservedRanges === undefined ? existing.reservedRanges : Array.isArray(body.reservedRanges) ? body.reservedRanges : [],
      floatingRanges: body.floatingRanges === undefined ? existing.floatingRanges : Array.isArray(body.floatingRanges) ? body.floatingRanges : [],
      failoverRanges: body.failoverRanges === undefined ? existing.failoverRanges : Array.isArray(body.failoverRanges) ? body.failoverRanges : [],
      vlanTag: body.vlanTag === undefined ? existing.vlanTag : body.vlanTag === null || String(body.vlanTag) === "" ? null : Number(body.vlanTag),
      bridgeOverride: body.bridgeOverride === undefined ? existing.bridgeOverride : body.bridgeOverride ? String(body.bridgeOverride).trim() : null,
      regionTag: body.regionTag === undefined ? existing.regionTag : body.regionTag ? String(body.regionTag).trim() : null,
      region: body.region === undefined ? existing.region : body.region ? String(body.region).trim() : null,
      allocationPriority: body.allocationPriority === undefined ? existing.allocationPriority : Number(body.allocationPriority || 100),
      fallbackPriority: body.fallbackPriority === undefined ? existing.fallbackPriority : Number(body.fallbackPriority || 100),
      appliesToAllNodes: body.appliesToAllNodes === undefined ? existing.appliesToAllNodes : body.appliesToAllNodes === true,
      appliesToAllProducts: body.appliesToAllProducts === undefined ? existing.appliesToAllProducts : body.appliesToAllProducts === true,
      staticOnly: body.staticOnly === undefined ? existing.staticOnly : body.staticOnly !== false,
      failoverPoolIds: body.failoverPoolIds === undefined ? existing.failoverPoolIds : Array.isArray(body.failoverPoolIds) ? body.failoverPoolIds.map((id: unknown) => String(id || "").trim()).filter(Boolean) : [],
      healthStatus: body.healthStatus === undefined ? existing.healthStatus : String(body.healthStatus || "healthy").trim() || "healthy",
      exhaustionDetected: body.exhaustionDetected === undefined ? existing.exhaustionDetected : body.exhaustionDetected === true,
      duplicateIpsDetected: body.duplicateIpsDetected === undefined ? existing.duplicateIpsDetected : body.duplicateIpsDetected === true,
      isActive: body.isActive === undefined ? existing.isActive : Boolean(body.isActive),
      notes: body.notes === undefined ? existing.notes : body.notes ? String(body.notes) : null,
    }
    const validation = await validatePoolShape({ id, ...next })
    const outside = await activeAllocationsOutsideRange(id, validation.startIp, validation.endIp)
    if (outside.length && body.confirmMigration !== true) {
      return NextResponse.json({
        success: false,
        code: "range_shrink_requires_confirmation",
        error: "Active allocations would fall outside the new range. Confirm migration before shrinking this pool.",
        affectedAllocations: outside.map((allocation) => ({
          id: allocation.id,
          ipAddress: allocation.ipAddress,
          status: allocation.status,
          vmid: allocation.vmid,
          hostname: allocation.hostname,
          vps: allocation.vpsInstance ? {
            id: allocation.vpsInstance.id,
            name: allocation.vpsInstance.name,
            status: allocation.vpsInstance.status,
            customer: allocation.vpsInstance.customer,
          } : null,
        })),
      }, { status: 409 })
    }
    const pool = await prisma.$transaction(async (tx) => {
      const updated = await tx.ipPool.update({
        where: { id },
        data: {
          name: next.name,
          proxmoxNodeId: next.proxmoxNodeId,
          poolMode: next.poolMode as any,
          type: next.type,
          poolType: next.poolType,
          pricePerIp: next.pricePerIp,
          bulkEnabled: next.bulkEnabled,
          startIp: validation.startIp,
          endIp: validation.endIp,
          gateway: validation.gateway,
          cidr: validation.cidr,
          dns: next.dns,
          searchDomain: next.searchDomain,
          bridge: next.bridge,
          reservedRanges: next.reservedRanges as any,
          floatingRanges: next.floatingRanges as any,
          failoverRanges: next.failoverRanges as any,
          vlanTag: next.vlanTag,
          bridgeOverride: next.bridgeOverride,
          regionTag: next.regionTag,
          region: next.region,
          allocationPriority: next.allocationPriority,
          fallbackPriority: next.fallbackPriority,
          appliesToAllNodes: next.appliesToAllNodes,
          appliesToAllProducts: next.appliesToAllProducts,
          staticOnly: next.staticOnly,
          failoverPoolIds: next.failoverPoolIds as any,
          healthStatus: next.healthStatus,
          exhaustionDetected: next.exhaustionDetected,
          duplicateIpsDetected: next.duplicateIpsDetected,
          isActive: next.isActive,
          notes: next.notes,
        },
      })
      await syncPoolAllocations(id, validation.startIp, validation.endIp, tx)
      return updated
    })
    if (Array.isArray(body.assignedNodeIds)) {
      await setIpPoolNodeAssignments(pool.id, body.assignedNodeIds, Number(next.allocationPriority || 100))
      const productIds = (await getPoolProductAssignments(pool.id)).map((row) => row.productId).filter(Boolean)
      await recoverIpBlockedProvisioning({ productIds, actor: `admin:${admin.email}:ip_pool_node_assignment` }).catch(() => null)
    }
    const adminRow = await prisma.adminProfile.findUnique({ where: { email: String(admin.email).toLowerCase() }, select: { id: true } })
    if (adminRow) {
      await createAuditLog({
        adminId: adminRow.id,
        action: "ip_pool.edit",
        oldValue: { poolId: existing.id, name: existing.name, startIp: existing.startIp, endIp: existing.endIp, isActive: existing.isActive },
        newValue: { poolId: pool.id, name: pool.name, startIp: pool.startIp, endIp: pool.endIp, isActive: pool.isActive },
        userAgent: request.headers.get("user-agent"),
      })
    }
    await createPanelLog({
      category: "IP Pool",
      message: "IP pool edited",
      actorType: "admin",
      actorEmail: String(admin.email),
      metadata: { poolId: pool.id, oldRange: `${existing.startIp}-${existing.endIp}`, newRange: `${pool.startIp}-${pool.endIp}`, warnings: validation.warnings },
    })
    return NextResponse.json({ success: true, pool, warnings: validation.warnings })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || "Failed to update IP pool" }, { status: 400 })
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return PUT(request, context)
}

async function affectedAllocations(poolId: string) {
  return prisma.ipAllocation.findMany({
    where: { poolId, status: { in: ["RESERVED", "reserved", "ASSIGNED", "assigned", "USED", "used"] } },
    include: {
      vpsInstance: {
        include: {
          customer: { select: { id: true, email: true, name: true } },
        },
      },
    },
    orderBy: { ipAddress: "asc" },
  })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const pool = await prisma.ipPool.findUnique({ where: { id } })
  if (!pool) return NextResponse.json({ success: false, error: "IP pool not found" }, { status: 404 })
  const active = await affectedAllocations(id)
  if (active.length) {
    return NextResponse.json({
      success: false,
      code: "active_allocations",
      error: "This pool has active IP allocations",
      affectedVps: active.map((allocation) => ({
        allocationId: allocation.id,
        hostname: allocation.vpsInstance?.name || allocation.hostname || "-",
        vmid: allocation.vmid || allocation.vpsInstance?.vmid || null,
        customer: allocation.vpsInstance?.customer || null,
        currentIp: allocation.ipAddress,
        status: allocation.vpsInstance?.status || allocation.status,
        vpsInstanceId: allocation.vpsInstanceId,
      })),
    }, { status: 409 })
  }
  await prisma.ipPool.delete({ where: { id } })
  const adminRow = await prisma.adminProfile.findUnique({ where: { email: String(admin.email).toLowerCase() }, select: { id: true } })
  if (adminRow) {
    await createAuditLog({
      adminId: adminRow.id,
      action: "ip_pool.delete",
      oldValue: { poolId: pool.id, name: pool.name, startIp: pool.startIp, endIp: pool.endIp },
      userAgent: request.headers.get("user-agent"),
    })
  }
  await createPanelLog({
    category: "IP Pool",
    message: "IP pool deleted",
    actorType: "admin",
    actorEmail: String(admin.email),
    metadata: { poolId: pool.id, name: pool.name, range: `${pool.startIp}-${pool.endIp}` },
  })
  return NextResponse.json({ success: true })
}
