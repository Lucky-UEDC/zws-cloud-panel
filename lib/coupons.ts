import { prisma } from "@/lib/db"
import { formatCurrency } from "@/lib/currency-format"
import type { Prisma } from "@prisma/client"

export type CouponValidationInput = {
  code: string
  customerId?: string | null
  productId?: string | null
  termMonths?: number | null
  subtotal: number
  taxAmount?: number
}

export type CouponValidationResult = {
  valid: boolean
  code?: string
  couponId?: string
  discountAmount: number
  finalAmount: number
  discountPercent?: number
  reason?: string
}

function normalizeStringList(value: any): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item))
}

function normalizeNumberList(value: any): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
}

function couponDuration(value: unknown) {
  const raw = String(value || "FIRST_INVOICE_ONLY").trim().toUpperCase()
  if (["EVERY_RENEWAL", "CUSTOM_CYCLES"].includes(raw)) return raw
  return "FIRST_INVOICE_ONLY"
}

export function validCouponRedemptionWhere(couponId?: string | null) {
  return {
    ...(couponId ? { couponId } : {}),
    status: { notIn: ["void", "deleted", "cancelled", "canceled"] },
    order: { is: { deletedAt: null, status: { notIn: ["DELETED", "deleted", "cancelled", "canceled", "archived", "failed", "payment_failed"] } } },
  }
}

export async function recordCouponRedemption(input: {
  couponId?: string | null
  orderId?: string | null
  customerId?: string | null
  paymentId?: string | null
  discountAmount?: number | null
  gatewayOrderId?: string | null
  gatewayPaymentId?: string | null
  metadata?: Record<string, unknown>
}) {
  const couponId = String(input.couponId || "").trim()
  const orderId = String(input.orderId || "").trim()
  const customerId = String(input.customerId || "").trim()
  if (!couponId || !orderId || !customerId || Number(input.discountAmount || 0) <= 0) return null
  return prisma.couponRedemption.upsert({
    where: { couponId_orderId: { couponId, orderId } },
    create: {
      couponId,
      orderId,
      customerId,
      paymentId: input.paymentId || null,
      discountAmount: Number(input.discountAmount || 0),
      status: "completed",
      gatewayOrderId: input.gatewayOrderId || null,
      gatewayPaymentId: input.gatewayPaymentId || null,
      metadata: (input.metadata || {}) as Prisma.InputJsonValue,
    },
    update: {
      customerId,
      paymentId: input.paymentId || undefined,
      discountAmount: Number(input.discountAmount || 0),
      status: "completed",
      gatewayOrderId: input.gatewayOrderId || undefined,
      gatewayPaymentId: input.gatewayPaymentId || undefined,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  }).catch(() => null)
}

export async function validateCoupon(input: CouponValidationInput): Promise<CouponValidationResult> {
  const now = new Date()
  const code = String(input.code || "").trim().toUpperCase()
  const subtotal = Number(input.subtotal || 0)
  const discountBase = Number(subtotal.toFixed(2))

  if (!code) {
    return { valid: false, discountAmount: 0, finalAmount: subtotal, reason: "Coupon code is required" }
  }
  if (!Number.isFinite(subtotal) || subtotal <= 0) {
    return { valid: false, discountAmount: 0, finalAmount: 0, reason: "Invalid order amount" }
  }

  const coupon = await prisma.coupon.findUnique({ where: { code } })
  if (!coupon || !coupon.active) {
    return { valid: false, discountAmount: 0, finalAmount: subtotal, reason: "Coupon is invalid or inactive" }
  }
  if (coupon.startsAt && coupon.startsAt > now) {
    return { valid: false, discountAmount: 0, finalAmount: subtotal, reason: "Coupon is not active yet" }
  }
  if (coupon.expiresAt && coupon.expiresAt < now) {
    return { valid: false, discountAmount: 0, finalAmount: subtotal, reason: "Coupon has expired" }
  }

  const minOrderAmount = coupon.minOrderAmount == null ? null : Number(coupon.minOrderAmount)
  if (minOrderAmount != null && subtotal < minOrderAmount) {
    return { valid: false, discountAmount: 0, finalAmount: subtotal, reason: `Minimum order amount is ${formatCurrency(minOrderAmount, "INR")}` }
  }

  const allowedProducts = normalizeStringList(coupon.applicableProducts)
  let product: { id: string; slug: string; category: string | null; categoryId: string | null; subcategoryId: string | null } | null = null
  if ((allowedProducts.length > 0 || normalizeStringList((coupon as any).applicableProductGroups).length > 0) && input.productId) {
    product = await prisma.product.findUnique({ where: { id: input.productId }, select: { id: true, slug: true, category: true, categoryId: true, subcategoryId: true } }).catch(() => null)
  }
  if (allowedProducts.length > 0 && input.productId && !allowedProducts.includes(String(input.productId)) && !allowedProducts.includes(String(product?.slug || ""))) {
    return { valid: false, discountAmount: 0, finalAmount: subtotal, reason: "Coupon is not applicable for this product" }
  }

  const allowedProductGroups = normalizeStringList((coupon as any).applicableProductGroups)
  if (allowedProductGroups.length > 0 && input.productId) {
    const productGroups = [product?.category, product?.categoryId, product?.subcategoryId].filter(Boolean).map(String)
    if (!productGroups.some((item) => allowedProductGroups.includes(item))) {
      return { valid: false, discountAmount: 0, finalAmount: subtotal, reason: "Coupon is not applicable for this product group" }
    }
  }

  const allowedTerms = normalizeNumberList(coupon.applicableBillingTerms)
  if (allowedTerms.length > 0 && input.termMonths && !allowedTerms.includes(Number(input.termMonths))) {
    return { valid: false, discountAmount: 0, finalAmount: subtotal, reason: "Coupon is not applicable for this billing term" }
  }

  if (coupon.usageLimit != null) {
    const totalUsed = await prisma.couponRedemption.count({ where: validCouponRedemptionWhere(coupon.id) })
    if (totalUsed >= coupon.usageLimit) {
      return { valid: false, discountAmount: 0, finalAmount: subtotal, reason: "Coupon usage limit reached" }
    }
  }

  if (coupon.usageLimitPerUser != null && input.customerId) {
    const userUsed = await prisma.couponRedemption.count({
      where: { ...validCouponRedemptionWhere(coupon.id), customerId: String(input.customerId) },
    })
    if (userUsed >= coupon.usageLimitPerUser) {
      return { valid: false, discountAmount: 0, finalAmount: subtotal, reason: "Coupon usage limit reached for this account" }
    }
  }

  if (input.customerId) {
    const userCycles = await prisma.couponRedemption.count({
      where: { ...validCouponRedemptionWhere(coupon.id), customerId: String(input.customerId) },
    })
    const duration = couponDuration((coupon as any).duration)
    if (duration === "FIRST_INVOICE_ONLY" && userCycles >= 1) {
      return { valid: false, discountAmount: 0, finalAmount: subtotal, reason: "Coupon is valid for the first invoice only" }
    }
    if (duration === "CUSTOM_CYCLES") {
      const maxCycles = Math.max(1, Number((coupon as any).durationCycles || 1))
      if (userCycles >= maxCycles) {
        return { valid: false, discountAmount: 0, finalAmount: subtotal, reason: `Coupon is valid for ${maxCycles} billing cycle${maxCycles === 1 ? "" : "s"} only` }
      }
    }
  }

  const discountValue = Number(coupon.discountValue || 0)
  let discountAmount = 0
  if (coupon.discountType === "PERCENTAGE") {
    discountAmount = Number((discountBase * (discountValue / 100)).toFixed(2))
  } else {
    discountAmount = discountValue
  }

  const maxDiscountAmount = coupon.maxDiscountAmount == null ? null : Number(coupon.maxDiscountAmount)
  if (maxDiscountAmount != null) {
    discountAmount = Math.min(discountAmount, maxDiscountAmount)
  }

  discountAmount = Math.max(0, Math.min(discountAmount, subtotal))
  const finalAmount = Number((subtotal - discountAmount).toFixed(2))
  const discountPercent = subtotal > 0 ? Number(((discountAmount / subtotal) * 100).toFixed(1)) : 0

  return {
    valid: true,
    code: coupon.code,
    couponId: coupon.id,
    discountAmount,
    finalAmount,
    discountPercent,
  }
}
