import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManageCatalog } from "@/lib/admin-rbac"
import { revalidateProductSurfaces } from "@/lib/product-revalidation"
import { validCouponRedemptionWhere } from "@/lib/coupons"

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageCatalog(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const coupons = await prisma.coupon.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      redemptions: { where: validCouponRedemptionWhere(), select: { discountAmount: true, customerId: true, status: true, redeemedAt: true } },
    },
  })
  return NextResponse.json(
    coupons.map((coupon) => ({
      ...coupon,
      discountValue: Number(coupon.discountValue),
      maxDiscountAmount: coupon.maxDiscountAmount == null ? null : Number(coupon.maxDiscountAmount),
      minOrderAmount: coupon.minOrderAmount == null ? null : Number(coupon.minOrderAmount),
      usageCount: coupon.redemptions.length,
      timesUsed: coupon.redemptions.length,
      revenueImpact: coupon.redemptions.reduce((sum, row) => sum + Number(row.discountAmount || 0), 0),
      discountGiven: coupon.redemptions.reduce((sum, row) => sum + Number(row.discountAmount || 0), 0),
      remainingUses: coupon.usageLimit == null ? null : Math.max(0, Number(coupon.usageLimit) - coupon.redemptions.length),
      customerUsage: new Set(coupon.redemptions.map((row) => row.customerId)).size,
      lastUsed: coupon.redemptions.map((row) => row.redeemedAt).sort((a, b) => b.getTime() - a.getTime())[0] || null,
    }))
  )
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageCatalog(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const code = String(body?.code || "").trim().toUpperCase()
    if (!code) return NextResponse.json({ error: "Coupon code is required" }, { status: 400 })

    const coupon = await prisma.coupon.create({
      data: {
        code,
        description: body?.description ? String(body.description) : null,
        discountType: body?.discountType === "PERCENTAGE" ? "PERCENTAGE" : "FIXED",
        discountValue: Number(body?.discountValue || 0),
        maxDiscountAmount: body?.maxDiscountAmount == null || body?.maxDiscountAmount === "" ? null : Number(body.maxDiscountAmount),
        minOrderAmount: body?.minOrderAmount == null || body?.minOrderAmount === "" ? null : Number(body.minOrderAmount),
        usageLimit: body?.usageLimit == null || body?.usageLimit === "" ? null : Number(body.usageLimit),
        usageLimitPerUser: body?.usageLimitPerUser == null || body?.usageLimitPerUser === "" ? null : Number(body.usageLimitPerUser),
        startsAt: body?.startsAt ? new Date(body.startsAt) : null,
        expiresAt: body?.expiresAt ? new Date(body.expiresAt) : null,
        active: Boolean(body?.active ?? true),
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
    if (String(error?.code) === "P2002") return NextResponse.json({ error: "Coupon code already exists" }, { status: 400 })
    return NextResponse.json({ error: error?.message || "Failed to create coupon" }, { status: 500 })
  }
}
