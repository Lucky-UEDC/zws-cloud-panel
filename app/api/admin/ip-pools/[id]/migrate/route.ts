import { NextRequest, NextResponse } from "next/server"
import { createAuditLog } from "@/lib/audit-log"
import { prisma } from "@/lib/db"
import { reserveIpFromPool } from "@/lib/ip-pool"
import { createPanelLog } from "@/lib/panel-log"
import { createProxmoxClient, PROXMOX_LONG_TIMEOUT_MS } from "@/lib/proxmox"
import { withRedisLock } from "@/lib/redis"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"

type MigrationMode = "migrate_all" | "manual_replacements" | "release_reserved_only"

const ACTIVE_STATUSES = ["RESERVED", "reserved", "ASSIGNED", "assigned", "USED", "used"]

async function logMigration(message: string, input: {
  adminEmail: string
  poolId: string
  targetPoolId?: string | null
  allocationId?: string | null
  vpsInstanceId?: string | null
  vmid?: number | null
  level?: "info" | "warn" | "error"
  metadata?: Record<string, unknown>
}) {
  await createPanelLog({
    category: "IP Pool",
    level: input.level || "info",
    message,
    actorType: "admin",
    actorEmail: input.adminEmail,
    vpsInstanceId: input.vpsInstanceId || null,
    vmid: input.vmid || null,
    metadata: {
      poolId: input.poolId,
      targetPoolId: input.targetPoolId || null,
      allocationId: input.allocationId || null,
      ...(input.metadata || {}),
    },
  })
}

async function loadActiveAllocations(poolId: string) {
  return prisma.ipAllocation.findMany({
    where: { poolId, status: { in: ACTIVE_STATUSES } },
    include: {
      pool: true,
      vpsInstance: {
        include: {
          customer: { select: { id: true, email: true, name: true } },
          proxmoxNode: true,
        },
      },
    },
    orderBy: { ipAddress: "asc" },
  })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const mode = String(body.mode || "") as MigrationMode
  const targetPoolId = body.targetPoolId ? String(body.targetPoolId) : null
  const replacements = body.replacements && typeof body.replacements === "object" ? body.replacements as Record<string, string> : {}
  if (!["migrate_all", "manual_replacements", "release_reserved_only"].includes(mode)) {
    return NextResponse.json({ success: false, error: "Invalid migration mode" }, { status: 400 })
  }

  try {
    const result = await withRedisLock(`lock:ip-pool-migrate:${id}`, 60000, async () => {
      const pool = await prisma.ipPool.findUnique({ where: { id } })
      if (!pool) throw new Error("IP pool not found")

      if (mode === "release_reserved_only") {
        const released = await prisma.ipAllocation.updateMany({
          where: {
            poolId: id,
            status: { in: ACTIVE_STATUSES },
            vpsInstanceId: null,
            vmid: null,
          },
          data: {
            status: "free",
            allocationLockKey: null,
            vpsInstanceId: null,
            vmid: null,
            hostname: null,
            releasedAt: new Date(),
          },
        })
        await logMigration("Released unused reserved IPs", { adminEmail: String(admin.email), poolId: id, metadata: { released: released.count } })
        const remaining = await prisma.ipAllocation.count({ where: { poolId: id, status: { in: ACTIVE_STATUSES } } })
        if (remaining) {
          return { deleted: false, released: released.count, remaining, message: "Reserved-only allocations released. Active VPS allocations remain." }
        }
        await prisma.ipPool.delete({ where: { id } })
        await logMigration("IP pool deleted", { adminEmail: String(admin.email), poolId: id, metadata: { mode } })
        return { deleted: true, released: released.count, remaining: 0 }
      }

      if (!targetPoolId) throw new Error("Target IP pool is required")
      const active = await loadActiveAllocations(id)
      const moved: Array<{ vpsInstanceId: string | null; oldIp: string; newIp?: string; vmid?: number | null; rebootRequired?: boolean }> = []
      const skipped: Array<{ allocationId: string; reason: string }> = []

      for (const allocation of active) {
        const vps = allocation.vpsInstance
        if (!vps?.id || !vps.vmid) {
          await prisma.ipAllocation.update({
            where: { id: allocation.id },
            data: { status: "free", allocationLockKey: null, vpsInstanceId: null, vmid: null, hostname: null, releasedAt: new Date() },
          })
          skipped.push({ allocationId: allocation.id, reason: "released reservation without VPS" })
          continue
        }

        const requestedIp = mode === "manual_replacements" ? String(replacements[vps.id] || replacements[allocation.id] || "").trim() : null
        if (mode === "manual_replacements" && !requestedIp) throw new Error(`Replacement IP is required for VMID ${vps.vmid}`)

        const reserved = await prisma.$transaction((tx) => reserveIpFromPool({
          poolId: targetPoolId,
          vpsInstanceId: vps.id,
          vmid: vps.vmid,
          hostname: vps.name,
          requestedIp,
          assignedBy: String(admin.email),
        }, tx))
        await logMigration("New address allocated", {
          adminEmail: String(admin.email),
          poolId: id,
          targetPoolId,
          allocationId: allocation.id,
          vpsInstanceId: vps.id,
          vmid: vps.vmid,
          metadata: { oldIp: allocation.ipAddress, newIp: reserved.ipAddress },
        })

        try {
          if (!vps.proxmoxNode) throw new Error("VPS has no Proxmox node configured")
          const client = createProxmoxClient(vps.proxmoxNode.host, vps.proxmoxNode.tokenId, vps.proxmoxNode.tokenSecret, {
            allowInsecureTls: vps.proxmoxNode.allowInsecureTls,
            timeoutMs: PROXMOX_LONG_TIMEOUT_MS,
          })
          await client.updateVMConfig(vps.proxmoxNode.nodeName, vps.vmid, {
            net0: `virtio,bridge=${reserved.pool.bridge || "vmbr0"}`,
            ipconfig0: `ip=${reserved.ipAddress}/${reserved.pool.cidr},gw=${reserved.pool.gateway}`,
            nameserver: reserved.pool.dns,
            ...(reserved.pool.searchDomain ? { searchdomain: reserved.pool.searchDomain } : {}),
          })
          await logMigration("Network configuration updated", {
            adminEmail: String(admin.email),
            poolId: id,
            targetPoolId,
            allocationId: allocation.id,
            vpsInstanceId: vps.id,
            vmid: vps.vmid,
            metadata: { oldIp: allocation.ipAddress, newIp: reserved.ipAddress },
          })
        } catch (error: any) {
          await prisma.ipAllocation.update({
            where: { id: reserved.id },
            data: { status: "free", allocationLockKey: null, vpsInstanceId: null, vmid: null, hostname: null, releasedAt: new Date() },
          }).catch(() => undefined)
          await logMigration("migration_failed", {
            adminEmail: String(admin.email),
            poolId: id,
            targetPoolId,
            allocationId: allocation.id,
            vpsInstanceId: vps.id,
            vmid: vps.vmid,
            level: "error",
            metadata: { oldIp: allocation.ipAddress, attemptedIp: reserved.ipAddress, error: error?.message || "Proxmox update failed" },
          })
          throw new Error(`Proxmox update failed for VMID ${vps.vmid}: ${error?.message || "unknown error"}`)
        }

        try {
          await prisma.$transaction(async (tx) => {
            await tx.vpsInstance.update({ where: { id: vps.id }, data: { ipAddress: reserved.ipAddress } })
            await tx.ipAllocation.update({
              where: { id: reserved.id },
              data: { status: "assigned", vpsInstanceId: vps.id, vmid: vps.vmid, hostname: vps.name, releasedAt: null },
            })
            await tx.ipAllocation.update({
              where: { id: allocation.id },
              data: { status: "free", allocationLockKey: null, releasedAt: new Date() },
            })
          })
        } catch (error: any) {
          await logMigration("migration_failed", {
            adminEmail: String(admin.email),
            poolId: id,
            targetPoolId,
            allocationId: allocation.id,
            vpsInstanceId: vps.id,
            vmid: vps.vmid,
            level: "error",
            metadata: { oldIp: allocation.ipAddress, newIp: reserved.ipAddress, retryRequired: true, error: error?.message || "Database commit failed after Proxmox update" },
          })
          throw error
        }

        await logMigration("Instance requires reboot", {
          adminEmail: String(admin.email),
          poolId: id,
          targetPoolId,
          allocationId: allocation.id,
          vpsInstanceId: vps.id,
          vmid: vps.vmid,
          level: "warn",
          metadata: { oldIp: allocation.ipAddress, newIp: reserved.ipAddress, rebootRequired: true },
        })
        await logMigration("Migration completed", {
          adminEmail: String(admin.email),
          poolId: id,
          targetPoolId,
          allocationId: allocation.id,
          vpsInstanceId: vps.id,
          vmid: vps.vmid,
          metadata: { oldIp: allocation.ipAddress, newIp: reserved.ipAddress },
        })
        moved.push({ vpsInstanceId: vps.id, oldIp: allocation.ipAddress, newIp: reserved.ipAddress, vmid: vps.vmid, rebootRequired: true })
      }

      const remaining = await prisma.ipAllocation.count({ where: { poolId: id, status: { in: ACTIVE_STATUSES } } })
      if (!remaining) {
        await prisma.ipPool.delete({ where: { id } })
        await logMigration("IP pool deleted after migration", { adminEmail: String(admin.email), poolId: id, targetPoolId, metadata: { moved: moved.length, skipped: skipped.length } })
      }
      return { deleted: remaining === 0, remaining, moved, skipped }
    })

    const adminRow = await prisma.adminProfile.findUnique({ where: { email: String(admin.email).toLowerCase() }, select: { id: true } })
    if (adminRow) {
      await createAuditLog({
        adminId: adminRow.id,
        action: "ip_pool.migrate",
        oldValue: { poolId: id },
        newValue: { mode, targetPoolId, result },
        userAgent: request.headers.get("user-agent"),
      })
    }
    return NextResponse.json({ success: true, result })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "IP pool migration failed" }, { status: 400 })
  }
}
