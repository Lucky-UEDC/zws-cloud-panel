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
  const range = request.nextUrl.searchParams.get("range") === "24h" ? "24h" : "1h"
  const payload = await getClientVmMetricSeries({ customerId, id, range })
  if (!payload) return NextResponse.json({ success: false, error: "Instance not found" }, { status: 404 })
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } })
}
