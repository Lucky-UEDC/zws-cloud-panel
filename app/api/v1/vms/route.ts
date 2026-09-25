import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { authenticateApiKey, requireScope, customerFilter } from "@/lib/api/auth"
import { hostnameFromIp } from "@/lib/vm-hostname"

export const dynamic = "force-dynamic"
export const revalidate = 0

// GET /api/v1/vms — list VMs. Reseller keys see all; client keys see only their own.
export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req)
  if ("error" in auth) return auth.error
  const scopeErr = requireScope(auth.ctx, "vm:read")
  if (scopeErr) return scopeErr

  const customerId = customerFilter(auth.ctx)
  const vms = await prisma.vpsInstance.findMany({
    where: { deletedAt: null, ...(customerId ? { customerId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true, vmid: true, ipAddress: true, status: true, diskGb: true, cpuCores: true, ramGb: true,
      orderId: true, createdAt: true, proxmoxNode: { select: { nodeName: true } },
    },
  })

  return NextResponse.json({
    data: vms.map((v) => ({
      id: v.id,
      vmid: v.vmid,
      hostname: hostnameFromIp(v.ipAddress),
      ipAddress: v.ipAddress,
      status: v.status,
      diskGb: v.diskGb,
      cpuCores: v.cpuCores,
      ramGb: v.ramGb,
      node: v.proxmoxNode?.nodeName || null,
      orderId: v.orderId,
      createdAt: v.createdAt,
    })),
  })
}
