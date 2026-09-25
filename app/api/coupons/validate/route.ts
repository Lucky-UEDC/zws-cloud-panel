import { NextRequest, NextResponse } from "next/server"
import { getClientFromRequest } from "@/lib/server-auth"
import { calculateCanonicalCheckoutPricing } from "@/lib/checkout-pricing"
import type { CheckoutApiSuccess } from "@/lib/checkout-shared"
import { requireRateLimit, requireTurnstile, securityGate } from "@/lib/security/forms"
import { validateSecurityField } from "@/lib/security/input"
import { rejectDetectedPayload } from "@/lib/security/abuse"

function success<T extends Record<string, unknown>>(data: T) {
  const body: CheckoutApiSuccess<T> = { ok: true, data }
  return NextResponse.json(body)
}

export async function POST(request: NextRequest) {
  const gate = await securityGate(request)
  if (!gate.ok) return gate.response

  try {
    const body = await request.json().catch(() => ({}))
    const captcha = await requireTurnstile(gate.ctx, body?.turnstileToken, "checkout")
    if (!captcha.ok) return captcha.response
    const rate = await requireRateLimit(gate.ctx, "coupon_validate", 20, 60 * 60_000)
    if (!rate.ok) return rate.response
    const codeResult = validateSecurityField(body?.code || "", "id", "Coupon")
    if (!codeResult.ok) {
      if (codeResult.detection.dangerous) return rejectDetectedPayload(gate.ctx, codeResult.detection, "code")
      return NextResponse.json({ ok: false, error: "Invalid coupon code", code: "invalid_request" }, { status: 400 })
    }
    const client = await getClientFromRequest(request).catch(() => null)

    const result = await calculateCanonicalCheckoutPricing({
      productId: body?.productId ? String(body.productId) : null,
      productSlug: body?.productSlug ? String(body.productSlug) : null,
      customerId: client?.sub ? String(client.sub) : null,
      term: body?.term || 1,
      couponCode: codeResult.value,
      customCpu: body?.config?.cpu,
      customRamGb: body?.config?.ram,
      customStorageGb: body?.config?.storage,
      customBandwidthTb: body?.config?.bandwidth,
      diskTier: body?.config?.diskTier,
      storagePoolId: body?.config?.storagePoolId,
      config: body?.config && typeof body.config === "object" ? body.config : null,
    })
    return success({
      valid: true,
      code: result.couponCode,
      couponId: result.couponId,
      discountAmount: result.discountAmount,
      finalAmount: result.payableToday,
      calculatedMonthlyPrice: result.fixedPricingMeta?.calculatedMonthlyPrice ?? null,
      productMonthlyPrice: result.fixedPricingMeta?.productMonthlyPrice ?? null,
      fixedDiscountAmount: result.fixedPricingMeta?.fixedDiscountAmount ?? 0,
      fixedDiscountPercent: result.fixedPricingMeta?.fixedDiscountPercent ?? 0,
      couponDiscountAmount: result.discountAmount,
      taxAmount: result.taxAmount,
      payableToday: result.payableToday,
    })
  } catch (error: any) {
    const status = Number(error?.status || 500)
    return NextResponse.json({ ok: false, error: error?.message || "Failed to validate coupon", code: error?.code || "COUPON_VALIDATE_FAILED" }, { status })
  }
}
