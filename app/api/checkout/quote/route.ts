import { NextRequest, NextResponse } from "next/server"
import { calculateCheckoutQuote, type CheckoutApiError, type CheckoutApiSuccess, type CheckoutQuoteResult } from "@/lib/checkout-shared"
import { getClientFromRequest } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

function jsonError(error: unknown) {
  const source = error as Error & { code?: string; status?: number }
  const body: CheckoutApiError = {
    ok: false,
    error: source?.message || "Failed to calculate quote",
    code: source?.code || "checkout_quote_failed",
  }
  return NextResponse.json(body, { status: source?.status || 500 })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const client = await getClientFromRequest(request).catch(() => null)
    const draft = body?.draft && typeof body.draft === "object" ? body.draft : {}
    const result = await calculateCheckoutQuote({
      productId: body?.productId ?? draft?.productId,
      productSlug: body?.productSlug ?? draft?.productSlug,
      customerId: client?.sub || null,
      request,
      term: body?.term ?? draft?.termMonths,
      region: body?.region ?? draft?.region,
      osTemplateId: body?.osTemplateId ?? draft?.osTemplateId,
      customCpu: body?.customCpu ?? draft?.customCpu,
      customRamGb: body?.customRamGb ?? draft?.customRamGb,
      customStorageGb: body?.customStorageGb ?? draft?.customStorageGb,
      customBandwidthTb: body?.customBandwidthTb ?? draft?.customBandwidthTb,
      diskTier: body?.diskTier ?? draft?.diskTier,
      storagePoolId: body?.storagePoolId ?? draft?.storagePoolId,
      premiumIps: body?.premiumIps ?? draft?.premiumIps,
      cpuTier: body?.cpuTier ?? draft?.cpuTier,
      nodeId: body?.nodeId ?? draft?.nodeId,
      couponCode: body?.couponCode,
      couponDiscount: body?.couponDiscount,
    })
    const response: CheckoutApiSuccess<CheckoutQuoteResult> = { ok: true, data: result }
    return NextResponse.json(response)
  } catch (error) {
    const source = error as Error & { code?: string; status?: number }
    console.error("[checkout_quote_failed]", {
      code: source?.code || "checkout_quote_failed",
      status: source?.status || 500,
      message: source?.message || "Failed to calculate quote",
    })
    return jsonError(error)
  }
}
