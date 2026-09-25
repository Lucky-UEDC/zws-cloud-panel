import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { isIpInRange, isIpInSubnet, isValidIpv4 } from "@/lib/ip-address"
import { isIpReservedByPool } from "@/lib/ip-pool"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await params
  const pool = await prisma.ipPool.findUnique({
    where: { id },
    include: {
      proxmoxNode: { select: { id: true, name: true, nodeName: true } },
      allocations: {
        include: {
          node: { select: { id: true, name: true, nodeName: true } },
          vpsInstance: {
            include: {
              customer: { select: { id: true, email: true, name: true } },
              order: { select: { id: true, orderNumber: true } },
              proxmoxNode: { select: { id: true, name: true, nodeName: true } },
            },
          },
        },
        orderBy: { ipAddress: "asc" },
      },
      vmIpAssignments: {
        where: { status: { in: ["active", "ACTIVE", "assigned", "ASSIGNED"] as any } },
        include: {
          proxmoxNode: { select: { id: true, name: true, nodeName: true } },
          vpsInstance: {
            include: {
              customer: { select: { id: true, email: true, name: true } },
              order: { select: { id: true, orderNumber: true } },
              proxmoxNode: { select: { id: true, name: true, nodeName: true } },
            },
          },
        },
      },
    },
  })
  if (!pool) return NextResponse.json({ success: false, error: "IP pool not found" }, { status: 404 })
  const assignmentsByAllocation = new Map<string, any>()
  const assignmentsByIp = new Map<string, any>()
  for (const assignment of pool.vmIpAssignments || []) {
    if (assignment.ipAllocationId) assignmentsByAllocation.set(assignment.ipAllocationId, assignment)
    if (assignment.ipAddress) assignmentsByIp.set(String(assignment.ipAddress), assignment)
  }
  const rows = pool.allocations.map((allocation) => {
    const assignment = assignmentsByAllocation.get(allocation.id) || assignmentsByIp.get(String(allocation.ipAddress))
    const allocationStatus = String(allocation.status || "")
    const allocationOwnsVm = !["FREE", "free", "RELEASED", "released"].includes(allocationStatus) && Boolean(allocation.vpsInstanceId)
    const vm = assignment?.vpsInstance || (allocationOwnsVm ? allocation.vpsInstance : null) || null
    const node = assignment?.proxmoxNode || (allocationOwnsVm ? allocation.node : null) || vm?.proxmoxNode || (pool as any).proxmoxNode || null
    const assignedDate = assignment?.attachedAt || allocation.createdAt || assignment?.createdAt || null
    const lastChanged = assignment?.updatedAt || allocation.updatedAt || vm?.updatedAt || null
    return {
      id: allocation.id,
      ipAddress: assignment?.ipAddress || allocation.ipAddress,
      status: assignment?.status || allocation.status,
      displayStatus: ["FREE", "free", "RELEASED", "released"].includes(String(allocation.status)) && !assignment ? "Available" : ["RESERVED", "reserved"].includes(String(allocation.status)) ? "Reserved" : "Assigned",
      hostname: vm?.name || null,
      vmid: assignment?.vmid || (allocationOwnsVm ? allocation.vmid : null) || vm?.vmid || null,
      vpsInstanceId: assignment?.vpsInstanceId || (allocationOwnsVm ? allocation.vpsInstanceId : null) || vm?.id || null,
      nodeName: node?.name || node?.nodeName || null,
      nodeId: assignment?.proxmoxNodeId || (allocationOwnsVm ? allocation.nodeId : null) || vm?.proxmoxNodeId || null,
      assignedDate,
      lastChanged,
      customer: vm?.customer || null,
      order: vm?.order || null,
      createdAt: allocation.createdAt,
      updatedAt: allocation.updatedAt,
    }
  })
  const existingIps = new Set(rows.map((row) => String(row.ipAddress)))
  for (const assignment of pool.vmIpAssignments || []) {
    if (!assignment.ipAddress || existingIps.has(String(assignment.ipAddress))) continue
    const vm = assignment.vpsInstance || null
    const node = assignment.proxmoxNode || vm?.proxmoxNode || null
    rows.push({
      id: assignment.id,
      ipAddress: assignment.ipAddress,
      status: assignment.status,
      displayStatus: "Assigned",
      hostname: vm?.name || null,
      vmid: assignment.vmid || vm?.vmid || null,
      vpsInstanceId: assignment.vpsInstanceId,
      nodeName: node?.name || node?.nodeName || null,
      nodeId: assignment.proxmoxNodeId || vm?.proxmoxNodeId || null,
      assignedDate: assignment.attachedAt || assignment.createdAt,
      lastChanged: assignment.updatedAt,
      customer: vm?.customer || null,
      order: vm?.order || null,
      createdAt: assignment.createdAt,
      updatedAt: assignment.updatedAt,
    })
  }
  return NextResponse.json({
    success: true,
    pool,
    allocations: rows,
  })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const ipAddress = String(body.ipAddress || "").trim()
  const action = String(body.action || "").trim().toLowerCase()
  if (["add", "add-ip", "import"].includes(action)) {
    if (!isValidIpv4(ipAddress)) {
      return NextResponse.json({ success: false, error: "A valid IPv4 address is required." }, { status: 400 })
    }
    const pool = await prisma.ipPool.findUnique({ where: { id } })
    if (!pool) return NextResponse.json({ success: false, error: "IP pool not found." }, { status: 404 })
    try {
      if (!isIpInRange(ipAddress, pool.startIp, pool.endIp) || !isIpInSubnet(ipAddress, pool.startIp, Number(pool.cidr || 24))) {
        return NextResponse.json({ success: false, error: "IP address is outside this pool range/subnet." }, { status: 400 })
      }
    } catch (error: any) {
      return NextResponse.json({ success: false, error: error.message || "Invalid pool range." }, { status: 400 })
    }
    if (isIpReservedByPool(pool, ipAddress)) {
      return NextResponse.json({ success: false, error: "IP address is reserved by this pool." }, { status: 409 })
    }

    const duplicate = await prisma.ipAllocation.findFirst({
      where: { ipAddress, poolId: { not: id } },
      select: { id: true, poolId: true },
    })
    if (duplicate) return NextResponse.json({ success: false, error: "IP address already exists in another pool." }, { status: 409 })
    const ipAssignmentClient = (prisma as any).ipAssignment
    const assigned = await Promise.all([
      ipAssignmentClient ? ipAssignmentClient.findFirst({
        where: { assignedIp: ipAddress, releasedAt: null, status: { in: ["active", "assigned", "ACTIVE", "ASSIGNED"] } },
        select: { id: true },
      }).catch(() => null) : Promise.resolve(null),
      prisma.vmIpAssignment.findFirst({
        where: { ipAddress, family: "ipv4", status: { in: ["active", "assigned", "ACTIVE", "ASSIGNED"] } },
        select: { id: true },
      }).catch(() => null),
      prisma.vpsInstance.findFirst({
        where: { ipAddress, status: { notIn: ["DELETED", "TERMINATED", "CANCELLED", "CANCELED"] } },
        select: { id: true },
      }).catch(() => null),
    ])
    if (assigned.some(Boolean)) return NextResponse.json({ success: false, error: "IP address is already assigned to a VM." }, { status: 409 })

    const existing = await prisma.ipAllocation.findUnique({ where: { poolId_ipAddress: { poolId: id, ipAddress } } })
    if (existing) {
      if (["free", "FREE", "released", "RELEASED"].includes(String(existing.status))) {
        return NextResponse.json({ success: true, allocation: existing, reused: true })
      }
      return NextResponse.json({ success: false, error: `IP allocation already exists with status ${existing.status}.` }, { status: 409 })
    }

    const created = await prisma.ipAllocation.create({
      data: {
        poolId: id,
        ipAddress,
        status: "free",
        allocationType: "default",
      },
    })
    return NextResponse.json({ success: true, allocation: created, reused: false })
  }

  const statusByAction: Record<string, string> = {
    reserve: "reserved",
    block: "blocked",
    damage: "damaged",
    maintenance: "maintenance",
    free: "free",
    release: "free",
  }
  const nextStatus = statusByAction[action]
  if (!ipAddress || !nextStatus) {
    return NextResponse.json({ success: false, error: "Valid ipAddress and action are required." }, { status: 400 })
  }

  const allocation = await prisma.ipAllocation.findUnique({
    where: { poolId_ipAddress: { poolId: id, ipAddress } },
  })
  if (!allocation) {
    return NextResponse.json({ success: false, error: "IP allocation not found in this pool." }, { status: 404 })
  }
  if (allocation.vpsInstanceId && nextStatus !== "free" && body.forceOverride !== true) {
    return NextResponse.json({ success: false, error: "Assigned IPs require forceOverride before changing status." }, { status: 409 })
  }

  const updated = await prisma.ipAllocation.update({
    where: { id: allocation.id },
    data: {
      status: nextStatus,
      ...(nextStatus === "free"
        ? { vpsInstanceId: null, vmid: null, hostname: null, allocationLockKey: null, releasedAt: new Date() }
        : {}),
    },
  })
  return NextResponse.json({ success: true, allocation: updated })
}
