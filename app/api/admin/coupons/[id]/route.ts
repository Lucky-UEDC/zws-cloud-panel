import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManageCatalog } from "@/lib/admin-rbac"
import { revalidateProductSurfaces } from "@/lib/product-revalidation"
import { validCouponRedemptionWhere } from "@/lib/coupons"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageCatalog(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await params
  const coupon = await prisma.coupon.findUnique({
    where: { id },
    include: { redemptions: { where: validCouponRedemptionWhere(id), orderBy: { redeemedAt: "desc" }, take: 50, include: { customer: { select: { id: true, email: true, name: true } }, order: { select: { id: true, orderNumber: true } } } } },
  })
  if (!coupon) return NextResponse.json({ error: "Coupon not found" }, { status: 404 })
  const [usage, aggregate, customers] = await Promise.all([
    prisma.couponRedemption.count({ where: validCouponRedemptionWhere(id) }),
    prisma.couponRedemption.aggregate({ where: validCouponRedemptionWhere(id), _sum: { discountAmount: true }, _max: { redeemedAt: true } }),
    prisma.couponRedemption.findMany({ where: validCouponRedemptionWhere(id), select: { customerId: true }, distinct: ["customerId"] }),
  ])
  const timesUsed = usage
  const revenueImpact = Number(aggregate._sum.discountAmount || 0)
  return NextResponse.json({
    ...coupon,
    discountValue: Number(coupon.discountValue),
    maxDiscountAmount: coupon.maxDiscountAmount == null ? null : Number(coupon.maxDiscountAmount),
    minOrderAmount: coupon.minOrderAmount == null ? null : Number(coupon.minOrderAmount),
    timesUsed,
    revenueImpact,
    discountGiven: revenueImpact,
    remainingUses: coupon.usageLimit == null ? null : Math.max(0, Number(coupon.usageLimit) - timesUsed),
    customerUsage: customers.length,
    lastUsed: aggregate._max.redeemedAt || null,
  })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageCatalog(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await params
  try {
    const body = await request.json()
    const code = String(body?.code || "").trim().toUpperCase()
    const coupon = await prisma.coupon.update({
      where: { id },
      data: {
        code: code || undefined,
        description: body?.description == null ? null : String(body.description),
        discountType: body?.discountType === "PERCENTAGE" ? "PERCENTAGE" : "FIXED",
        discountValue: Number(body?.discountValue || 0),
        maxDiscountAmount: body?.maxDiscountAmount == null || body?.maxDiscountAmount === "" ? null : Number(body.maxDiscountAmount),
        minOrderAmount: body?.minOrderAmount == null || body?.minOrderAmount === "" ? null : Number(body.minOrderAmount),
        usageLimit: body?.usageLimit == null || body?.usageLimit === "" ? null : Number(body.usageLimit),
        usageLimitPerUser: body?.usageLimitPerUser == null || body?.usageLimitPerUser === "" ? null : Number(body.usageLimitPerUser),
        startsAt: body?.startsAt ? new Date(body.startsAt) : null,
        expiresAt: body?.expiresAt ? new Date(body.expiresAt) : null,
        active: Boolean(body?.active),
        applicableProducts: Array.isArray(body?.applicableProducts) ? body.applicableProducts : [],
        applicableProductGroups: Array.isArray(body?.applicableProductGroups) ? body.applicableProductGroups : [],
        applicableBillingTerms: Array.isArray(body?.applicableBillingTerms) ? body.applicableBillingTerms.map((v: any) => Number(v)) : [],
        duration: ["FIRST_INVOICE_ONLY", "EVERY_RENEWAL", "CUSTOM_CYCLES"].includes(String(body?.duration || "")) ? String(body.duration) : "FIRST_INVOICE_ONLY",
        durationCycles: body?.durationCycles == null || body?.durationCycles === "" ? null : Number(body.durationCycles),
      },
    })
    revalidateProductSurfaces()
    return NextResponse.json(coupon)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to update coupon" }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageCatalog(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await params
  await prisma.coupon.delete({ where: { id } })
  revalidateProductSurfaces()
  return NextResponse.json({ success: true })
}
