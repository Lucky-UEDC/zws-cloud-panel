import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { performVpsPowerAction, type VpsPowerAction } from "@/lib/vps-control"
import { publishLiveVmSnapshot } from "@/lib/proxmox-live"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  try {
    const body = (await request.json().catch(() => ({}))) as { action?: VpsPowerAction }
    if (!body.action || !["start", "stop", "reboot", "forceStop"].includes(body.action)) {
      return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 })
    }

    const result = await performVpsPowerAction({ vpsId: id, action: body.action, customerId })
    const live = await publishLiveVmSnapshot(id, `client-action:${body.action}:complete`).catch(() => null)
    return NextResponse.json({ success: true, ...result, action: body.action, live }, { status: 202 })
  } catch (error: any) {
    const status = Number(error?.status || 500)
    return NextResponse.json({ success: false, error: error.message || "Action failed", code: error?.code || "ACTION_FAILED" }, { status })
  }
}
