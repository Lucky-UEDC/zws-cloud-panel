import { NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { quoteDiskUpgrade } from "@/lib/vps-disk-upgrades"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  try {
    const quote = await quoteDiskUpgrade({
      vpsId: id,
      customerId,
      operation: String(body.operation || "resize") as any,
      diskId: body.diskId ? String(body.diskId) : null,
      targetSizeGb: body.targetSizeGb ?? body.newSizeGb ?? body.newDiskGb,
      targetStoragePoolId: body.targetStoragePoolId || body.storagePoolId || null,
    })
    return NextResponse.json({ success: true, quote })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Unable to quote disk upgrade" }, { status: 400 })
  }
}
