import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { storageTypeLabel } from "@/lib/storage-pools"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { requireAdminFullAuth } from "@/lib/auth/guards"
import type { NextRequest } from "next/server"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(request: NextRequest) {
  const auth = await requireAdminFullAuth(request)
  if (!auth.ok) return auth.response
  const admin = { email: auth.session.email, role: auth.session.role }
  if (!admin.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  const pools = await prisma.nodeStoragePoolConfig.findMany({
    include: { proxmoxNode: { select: { id: true, name: true, nodeName: true } } },
    orderBy: [{ proxmoxNodeId: "asc" }, { sortOrder: "asc" }, { storageId: "asc" }],
  })
  return NextResponse.json({
    success: true,
    pools: pools.map((pool: any) => ({
      id: pool.id,
      nodeId: pool.proxmoxNodeId,
      nodeName: pool.proxmoxNode?.name || pool.proxmoxNode?.nodeName || "Node",
      storageId: pool.storageId,
      displayName: pool.displayName || pool.storageId,
      storageType: pool.storageType,
      storageTypeLabel: storageTypeLabel(pool),
      enabled: pool.enabled,
      defaultForNewVm: pool.defaultForNewVm,
      isUpgradeOnly: pool.isUpgradeOnly,
      missingFromProxmox: pool.missingFromProxmox,
    })),
  })
}
