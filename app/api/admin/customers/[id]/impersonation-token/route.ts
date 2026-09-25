import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { isAdminLikeRole } from "@/lib/admin-rbac"
import { extractClientIp } from "@/lib/request-context"
import { createAdminCustomerImpersonationToken } from "@/lib/admin-customer-impersonation"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const adminRow = await prisma.adminProfile.findUnique({
    where: { email: String(admin.email).toLowerCase() },
    select: { id: true, email: true, isActive: true },
  })
  if (!adminRow?.isActive) return NextResponse.json({ error: "Admin not found" }, { status: 404 })

  const { id } = await params
  const customer = await prisma.customer.findUnique({
    where: { id },
    select: { id: true, email: true, isActive: true, status: true },
  })
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 })
  if (!customer.isActive || ["BANNED", "CLOSED"].includes(String(customer.status || "").toUpperCase())) {
    return NextResponse.json({ error: "Customer account cannot be impersonated in its current state." }, { status: 409 })
  }

  const created = await createAdminCustomerImpersonationToken({
    adminId: adminRow.id,
    adminEmail: adminRow.email,
    customerId: customer.id,
    ipAddress: extractClientIp(request),
    userAgent: request.headers.get("user-agent"),
  })
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://myrdphub.com"
  const url = `${String(baseUrl).replace(/\/+$/, "")}/admin/impersonate/${encodeURIComponent(created.token)}`

  return NextResponse.json({
    success: true,
    url,
    token: created.token,
    expiresAt: created.expiresAt.toISOString(),
  })
}
