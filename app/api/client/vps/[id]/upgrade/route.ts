import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { startVpsUpgradePayment } from "@/lib/vps-upgrade-payment"

// startVpsUpgradePayment owns the createVpsUpgradeOrder flow and returns the
// upgrade_order_created payment contract: purpose: "upgrade_order",
// paymentMethod, invoiceId, paymentUrl, and redirectUrl.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  return startVpsUpgradePayment(request, id, customerId, body)
}
