import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { getCustomerServiceSpendMap } from "@/lib/revenue-analytics"
import { isAdminLikeRole } from "@/lib/admin-rbac"

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const customers = await prisma.customer.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { orders: true, payments: true, supportTickets: true } },
    },
  })
  const totalByCustomer = await getCustomerServiceSpendMap(customers.map((customer) => customer.id))

  const rows = [
    ["Name", "Email", "Wallet Balance", "Orders Count", "Service Spend", "Tickets Count", "Status", "Created At", "Last Login"],
    ...customers.map((customer) => [
      customer.name || "",
      customer.email,
      Number(customer.walletBalance || 0),
      customer._count.orders,
      totalByCustomer.get(customer.id) || 0,
      customer._count.supportTickets,
      customer.status,
      customer.createdAt.toISOString(),
      "",
    ]),
  ]

  return new NextResponse(rows.map((row) => row.map(csvCell).join(",")).join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
