import { NextRequest, NextResponse } from "next/server"
import { requirePricingAdminRead } from "@/lib/pricing-admin-security"
import { PRICING_COUNTRIES } from "@/lib/pricing-catalog"

export async function GET(request: NextRequest) {
  const guard = await requirePricingAdminRead(request)
  if ("response" in guard) return guard.response
  return NextResponse.json({ countries: PRICING_COUNTRIES })
}
