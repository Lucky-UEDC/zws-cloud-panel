import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { startVpsUpgradePayment } from "@/lib/vps-upgrade-payment"

export async function POST(request: NextRequest) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const vpsId = String(body.vpsInstanceId || body.vpsId || body.id || "")
  if (!vpsId) return NextResponse.json({ error: "VPS instance is required" }, { status: 400 })

  return startVpsUpgradePayment(request, vpsId, customerId, body)
}
