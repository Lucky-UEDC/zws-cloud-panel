import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getPublicOperatingSystems } from "@/lib/public-operating-systems"
import { getClientFromCookies } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  try {
    const vpsId = request.nextUrl.searchParams.get("vpsId")
    let nodeId = request.nextUrl.searchParams.get("nodeId")
    if (vpsId) {
      const customer = await getClientFromCookies()
      const customerId = String(customer?.sub || "")
      if (!customerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      const vps = await prisma.vpsInstance.findFirst({
        where: { id: vpsId, customerId, deletedAt: null, status: { not: "DELETED" } },
        select: { proxmoxNodeId: true },
      })
      if (!vps) return NextResponse.json({ error: "Instance not found" }, { status: 404 })
      nodeId = vps.proxmoxNodeId || null
    }
    return NextResponse.json(await getPublicOperatingSystems({ nodeId }))
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
