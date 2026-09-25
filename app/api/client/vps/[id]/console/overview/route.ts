import { NextResponse } from "next/server"
import { getConsoleOverview } from "@/lib/console-overview"
import { getClientFromCookies } from "@/lib/server-auth"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const overview = await getConsoleOverview(id, { type: "client", customerId })
  if (!overview) return NextResponse.json({ success: false, error: "Instance not found" }, { status: 404 })
  return NextResponse.json({ ...overview, node: null, vmid: null }, { headers: { "Cache-Control": "no-store" } })
}
