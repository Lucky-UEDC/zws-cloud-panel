import { NextRequest, NextResponse } from "next/server"
import { extractClientIp } from "@/lib/request-context"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { createWalletTransaction } from "@/lib/wallet"
import { createAuditLog } from "@/lib/audit-log"
import { isAdminLikeRole } from "@/lib/admin-rbac"
import { requireSensitiveAdminMfa } from "@/lib/admin-sensitive-action"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const stepUp = await requireSensitiveAdminMfa(request)
  if (!stepUp.ok) return stepUp.response

  const { id } = await params
  const adminRow = await prisma.adminProfile.findUnique({ where: { email: String(admin.email).toLowerCase() } })
  if (!adminRow) return NextResponse.json({ error: "Admin not found" }, { status: 404 })

  const body = (await request.json()) as {
    type?: "admin_add" | "admin_deduct"
    amount?: number
    reason?: string
    note?: string
  }

  const type = body.type
  const amount = Number(body.amount || 0)
  const reason = String(body.reason || "").trim()
  const note = String(body.note || "").trim()

  if (!type || !["admin_add", "admin_deduct"].includes(type)) {
    return NextResponse.json({ error: "Invalid adjustment type" }, { status: 400 })
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Amount must be positive" }, { status: 400 })
  }
  if (!reason) {
    return NextResponse.json({ error: "Reason is required" }, { status: 400 })
  }

  try {
    const tx = await prisma.$transaction(async (dbTx) => {
      const entry = await createWalletTransaction(dbTx as any, {
        customerId: id,
        type,
        amount,
        reason,
        note,
        createdByType: "admin",
        createdByAdminId: adminRow.id,
      })

      const customer = await dbTx.customer.findUnique({ where: { id }, select: { walletBalance: true } })
      await createAuditLog({
        adminId: adminRow.id,
        customerId: id,
        action: type === "admin_add" ? "CUSTOMER_CREDIT_ADDED" : "CUSTOMER_CREDIT_DEDUCTED",
        oldValue: { amount, reason },
        newValue: { balance: Number(customer?.walletBalance || 0), note },
        ipAddress: extractClientIp(request),
        userAgent: request.headers.get("user-agent"),
      })
      return { entry, walletBalance: Number(customer?.walletBalance || 0) }
    })

    return NextResponse.json({ success: true, transaction: tx.entry, walletBalance: tx.walletBalance })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to adjust wallet" },
      { status: 400 },
    )
  }
}
