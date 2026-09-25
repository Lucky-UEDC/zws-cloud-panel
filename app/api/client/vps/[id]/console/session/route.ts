import { NextRequest, NextResponse } from "next/server"
import { createConsoleSessionResponse } from "@/lib/console-session"
import { getClientFromCookies } from "@/lib/server-auth"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  return createConsoleSessionResponse(request, id, { type: "client", customerId })
}
