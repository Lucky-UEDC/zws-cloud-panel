import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getSiteUrl } from "@/lib/settings/site-settings"

export async function GET(request: NextRequest) {
  const merchantOrderId = request.nextUrl.searchParams.get("merchantOrderId") || request.nextUrl.searchParams.get("order_id") || ""
  if (merchantOrderId) {
    await prisma.paymentAttempt.updateMany({
      where: { merchantOrderId, status: { in: ["created", "started"] } },
      data: { status: "pending", statusCheckedAt: new Date() },
    }).catch(() => null)
  }
  return NextResponse.redirect(new URL(`/payment/status?order_id=${encodeURIComponent(merchantOrderId)}`, await getSiteUrl()))
}
