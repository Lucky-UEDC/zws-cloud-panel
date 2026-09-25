import { NextRequest, NextResponse } from "next/server"
import { getPublicPaymentRuntime } from "@/lib/payments/gateway-runtime-service"

export async function GET(request: NextRequest) {
  const runtime = await getPublicPaymentRuntime({ request, uncached: true })
  return NextResponse.json({ success: true, ...runtime }, { headers: { "cache-control": "no-store" } })
}
