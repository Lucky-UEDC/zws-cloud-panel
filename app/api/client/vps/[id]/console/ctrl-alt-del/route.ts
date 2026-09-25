import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { CONSOLE_DISABLED_MESSAGE, getConsoleAccess } from "@/lib/console-access"
import { sendProxmoxCtrlAltDel } from "@/lib/proxmox-vnc"
import { getClientFromCookies } from "@/lib/server-auth"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const customer = await getClientFromCookies()
    const customerId = String(customer?.sub || "")
    if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
    const { id } = await params
    const vps = await prisma.vpsInstance.findFirst({
      where: {
        OR: [{ id }, { orderId: id }],
        customerId,
        deletedAt: null,
        status: { not: "DELETED" },
      },
      include: {
        proxmoxNode: true,
        product: { select: { metadata: true } },
      },
    })
    if (!vps?.proxmoxNode || !vps.vmid) return NextResponse.json({ success: false, error: "Instance not found" }, { status: 404 })

    const consoleAccess = await getConsoleAccess(vps, { switches: { canUseSerial: false, canUseVnc: true } })
    if (!consoleAccess.graphical) {
      return NextResponse.json({ ok: false, success: false, error: CONSOLE_DISABLED_MESSAGE }, { status: 403 })
    }

    await sendProxmoxCtrlAltDel({
      host: vps.proxmoxNode.host,
      node: vps.proxmoxNode.nodeName,
      vmid: vps.vmid,
      tokenId: vps.proxmoxNode.tokenId,
      tokenSecret: vps.proxmoxNode.tokenSecret,
      allowInsecureTls: vps.proxmoxNode.allowInsecureTls,
    })
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Could not send Ctrl+Alt+Del" }, { status: 500 })
  }
}
