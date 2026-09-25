import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManageSettings } from "@/lib/admin-rbac"
import { createPanelLog } from "@/lib/panel-log"

export const dynamic = "force-dynamic"
export const revalidate = 0

const VALID_GATEWAYS = ["razorpay", "cashfree"]

export async function GET(_request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageSettings(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  const configs = await prisma.gatewayFeeConfig.findMany({ orderBy: { gateway: "asc" } })
  return NextResponse.json({ success: true, configs })
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageSettings(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  try {
    const body = await request.json().catch(() => ({}))
    const gateway = String(body.gateway || "").toLowerCase()
    if (!VALID_GATEWAYS.includes(gateway)) {
      return NextResponse.json({ success: false, error: `gateway must be one of: ${VALID_GATEWAYS.join(", ")}` }, { status: 400 })
    }
    const data = {
      gateway,
      feePercent: Math.max(0, Math.min(100, Number(body.feePercent ?? 0))),
      fixedFee: Math.max(0, Number(body.fixedFee ?? 0)),
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : true,
      minAmount: body.minAmount !== undefined && body.minAmount !== null && body.minAmount !== "" ? Math.max(0, Number(body.minAmount)) : null,
      maxAmount: body.maxAmount !== undefined && body.maxAmount !== null && body.maxAmount !== "" ? Math.max(0, Number(body.maxAmount)) : null,
      updatedBy: admin.email,
    }
    const config = await prisma.gatewayFeeConfig.upsert({
      where: { gateway },
      update: data,
      create: data,
    })
    await createPanelLog({
      category: "BILLING",
      message: "gateway_fee_config_updated",
      metadata: { gateway, feePercent: data.feePercent, fixedFee: data.fixedFee, enabled: data.enabled, admin: admin.email },
    }).catch(() => null)
    return NextResponse.json({ success: true, config })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Failed to save gateway fee config" }, { status: 500 })
  }
}