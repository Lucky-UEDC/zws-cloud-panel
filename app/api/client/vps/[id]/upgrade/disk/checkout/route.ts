import { NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { createDiskUpgradeOrder } from "@/lib/vps-disk-upgrades"
import { createPanelLog } from "@/lib/panel-log"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  try {
    const result = await createDiskUpgradeOrder({
      vpsId: id,
      customerId,
      operation: String(body.operation || "resize") as any,
      diskId: body.diskId ? String(body.diskId) : null,
      targetSizeGb: body.targetSizeGb ?? body.newSizeGb ?? body.newDiskGb,
      targetStoragePoolId: body.targetStoragePoolId || body.storagePoolId || null,
    })
    await createPanelLog({
      category: "Provisioning",
      message: "disk_upgrade_order_created",
      customerId,
      orderId: result.order.id,
      vpsInstanceId: id,
      metadata: { orderType: result.quote.orderType, amount: result.quote.payableToday, operation: result.quote.operation },
    }).catch(() => null)
    return NextResponse.json({
      success: true,
      orderId: result.order.id,
      orderNumber: result.order.orderNumber,
      amount: result.quote.payableToday,
      quote: result.quote,
      paid: result.order.status === "paid",
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Unable to create disk upgrade order" }, { status: 400 })
  }
}
