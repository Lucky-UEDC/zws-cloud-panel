import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { getClientVmMetricSeries } from "@/lib/vm-db-truth"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const range = (["1h", "24h", "48h"] as const).includes(request.nextUrl.searchParams.get("range") as any)
    ? request.nextUrl.searchParams.get("range")
    : "1h"
  const payload = await getClientVmMetricSeries({ customerId, id, range: range as "1h" | "24h" | "48h" })
  if (!payload) return NextResponse.json({ success: false, error: "Instance not found" }, { status: 404 })
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } })
}
