import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { authenticateApiKey, requireScope, customerFilter, apiError } from "@/lib/api/auth"
import { hostnameFromIp } from "@/lib/vm-hostname"

export const dynamic = "force-dynamic"
export const revalidate = 0

// GET /api/v1/vms/{id} — one VM (by VpsInstance id or orderId).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await authenticateApiKey(req)
  if ("error" in auth) return auth.error
  const scopeErr = requireScope(auth.ctx, "vm:read")
  if (scopeErr) return scopeErr

  const customerId = customerFilter(auth.ctx)
  const v = await prisma.vpsInstance.findFirst({
    where: { OR: [{ id }, { orderId: id }], deletedAt: null, ...(customerId ? { customerId } : {}) },
    select: {
      id: true, vmid: true, ipAddress: true, status: true, diskGb: true, cpuCores: true, ramGb: true,
      orderId: true, operatingSystemId: true, createdAt: true, proxmoxNode: { select: { nodeName: true } },
    },
  })
  if (!v) return apiError("not_found", "VM not found", 404)

  return NextResponse.json({
    data: {
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
      operatingSystemId: v.operatingSystemId,
      createdAt: v.createdAt,
    },
  })
}
