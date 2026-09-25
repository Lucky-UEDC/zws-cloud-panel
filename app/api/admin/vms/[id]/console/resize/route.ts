import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { CONSOLE_DISABLED_MESSAGE, getConsoleAccess } from "@/lib/console-access"
import { prisma } from "@/lib/db"
import { resizeProxmoxTermProxy } from "@/lib/proxmox-vnc"
import { getRedisClient } from "@/lib/redis"
import { getAdminFromCookies } from "@/lib/server-auth"

export const dynamic = "force-dynamic"
export const revalidate = 0

type ResizeSession = {
  actorType?: "client" | "admin"
  vpsId: string
  proxmoxNodeId: string
  nodeName: string
  vmid: number
  targetKind?: "qemu" | "lxc"
  termPort: number | string
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await getAdminFromCookies()
    if (!admin?.email || !canAccessAdminApi(admin.role)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const token = String(body?.resizeToken || "")
    const width = Number(body?.cols || body?.width || 0)
    const height = Number(body?.rows || body?.height || 0)
    if (!token || !Number.isFinite(width) || !Number.isFinite(height)) {
      return NextResponse.json({ success: false, error: "Invalid resize request" }, { status: 400 })
    }

    const redis = getRedisClient()
    if (!redis) return NextResponse.json({ success: false, error: "Console session store unavailable" }, { status: 503 })
    await redis.connect().catch(() => undefined)
    if (redis.status !== "ready") return NextResponse.json({ success: false, error: "Console session store unavailable" }, { status: 503 })

    const raw = await redis.get(`console:resize:${token}`)
    if (!raw || typeof raw !== "string") return NextResponse.json({ success: false, error: "Console resize session expired" }, { status: 440 })
    const session = JSON.parse(raw) as ResizeSession
    const { id } = await params
    if (session.actorType !== "admin" || session.vpsId !== id) {
      return NextResponse.json({ success: false, error: "Console permission denied" }, { status: 403 })
    }

    const vps = await prisma.vpsInstance.findFirst({
      where: { id, deletedAt: null, status: { not: "DELETED" } },
      include: { proxmoxNode: true, product: { select: { metadata: true } } },
    })
    if (!vps?.proxmoxNode || vps.proxmoxNodeId !== session.proxmoxNodeId) {
      return NextResponse.json({ success: false, error: "Instance unavailable" }, { status: 404 })
    }

    const consoleAccess = await getConsoleAccess(vps, { switches: { canUseSerial: true, canUseVnc: false } })
    if (!consoleAccess.terminal) return NextResponse.json({ ok: false, success: false, error: CONSOLE_DISABLED_MESSAGE }, { status: 403 })

    await resizeProxmoxTermProxy({
      host: vps.proxmoxNode.host,
      node: session.nodeName,
      vmid: session.vmid,
      targetKind: session.targetKind || "qemu",
      tokenId: vps.proxmoxNode.tokenId,
      tokenSecret: vps.proxmoxNode.tokenSecret,
      port: Number(session.termPort),
      width,
      height,
      allowInsecureTls: vps.proxmoxNode.allowInsecureTls,
    })
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Could not resize console" }, { status: 500 })
  }
}
