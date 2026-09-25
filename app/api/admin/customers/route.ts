import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { normalizeEmail } from "@/lib/checkout-identity"
import { getCustomerServiceSpendMap } from "@/lib/revenue-analytics"
import { isAdminLikeRole } from "@/lib/admin-rbac"
import { sanitizeCustomer } from "@/lib/customer-sanitize"

function serializeCustomer(customer: any, serviceSpend: number) {
  return {
    ...sanitizeCustomer(customer),
    walletBalance: Number(customer.walletBalance || 0),
    paymentsTotal: serviceSpend,
    serviceSpend,
  }
}

export async function GET(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, Number(searchParams.get("page") || 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") || 50)))
  const search = String(searchParams.get("search") || "").trim()
  const status = String(searchParams.get("status") || "").trim().toUpperCase()

  const where: any = {}
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
      { phoneNumber: { contains: search } },
    ]
  }
  if (status && status !== "ALL") {
    where.status = status
  }

  const [total, customers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        _count: { select: { orders: true, payments: true, invoices: true, supportTickets: true } },
      },
    }),
  ])

  const totalByCustomer = await getCustomerServiceSpendMap(customers.map((customer) => customer.id))

  return NextResponse.json({
    customers: customers.map((customer) => serializeCustomer(customer, totalByCustomer.get(customer.id) || 0)),
    pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
  })
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await request.json()) as {
    email?: string
    name?: string
    phone?: string
    company?: string
    password?: string
  }

  const email = normalizeEmail(body.email)
  const name = String(body.name || "").trim()
  const phone = String(body.phone || "").trim()
  const company = String(body.company || "").trim()
  const password = String(body.password || "")

  if (!email || !/^\S+@\S+\.\S+$/.test(email) || !name) {
    return NextResponse.json({ error: "Valid email and name are required" }, { status: 400 })
  }
  const duplicate = await prisma.customer.findUnique({ where: { email } })
  if (duplicate) {
    return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 })
  }

  const hashedPassword = password ? await bcrypt.hash(password, 10) : null

  try {
    const created = await prisma.customer.create({
      data: {
        email,
        name,
        phone: phone || null,
        company: company || null,
        hashedPassword,
      },
    })
    return NextResponse.json({ success: true, customer: sanitizeCustomer(created) }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create customer" },
      { status: 400 },
    )
  }
}
