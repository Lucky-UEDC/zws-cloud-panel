import { NextRequest, NextResponse } from "next/server"
import { extractClientIp } from "@/lib/request-context"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { createAuditLog } from "@/lib/audit-log"
import { sendEmail } from "@/lib/mailer"
import { createWalletTransaction } from "@/lib/wallet"
import { normalizeBillingAddress, normalizeEmail } from "@/lib/checkout-identity"
import { getCustomerServiceSpendMap } from "@/lib/revenue-analytics"
import { getBrandName } from "@/lib/settings/site-settings"
import { isAdminLikeRole } from "@/lib/admin-rbac"
import { deleteCustomerSafely } from "@/lib/customer-deletion"
import { sanitizeCustomer } from "@/lib/customer-sanitize"
import { safeJson } from "@/lib/safe-json"
import { requestId, writeStructuredLog, logApiError } from "@/lib/structured-logger"

const addressSchema = z.object({
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().regex(/^$|^\d{6}$/),
  country: z.string().optional(),
  gstin: z.string().regex(/^$|^[0-9A-Z]{15}$/),
  panNumber: z.string().optional(),
})

function relationWarning(name: string, error: unknown) {
  return {
    relation: name,
    message: error instanceof Error ? error.message : String(error || "Relation failed to load"),
  }
}

async function guardedRelation<T>(name: string, loader: () => Promise<T>, warnings: Array<{ relation: string; message: string }>, logContext: Record<string, unknown>, fallback: T): Promise<T> {
  try {
    return await loader()
  } catch (error) {
    const warning = relationWarning(name, error)
    warnings.push(warning)
    await writeStructuredLog("customer-page", "relation_load_failed", { ...logContext, relation: name, error })
    await logApiError({ ...logContext, route: "/api/admin/customers/[id]", relation: name, error })
    return fallback
  }
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const logId = requestId("customer")
  const startedAt = Date.now()
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    await writeStructuredLog("customer-page", "request", { requestId: logId, method: "GET", status: 401, durationMs: Date.now() - startedAt, failureReason: "unauthorized" })
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const logContext = { requestId: logId, customerId: id, actorEmail: admin.email }

  try {
    const customer = await prisma.customer.findUnique({ where: { id } })

    if (!customer) {
      await writeStructuredLog("customer-page", "request", { ...logContext, method: "GET", status: 404, durationMs: Date.now() - startedAt, failureReason: "customer_not_found" })
      return NextResponse.json({ error: "Customer not found" }, { status: 404 })
    }

    const warnings: Array<{ relation: string; message: string }> = []
    const [orders, payments, invoices, walletTransactions, supportTickets, auditLogs, spend] = await Promise.all([
      guardedRelation("orders", () => prisma.order.findMany({
        where: { customerId: id },
        orderBy: { createdAt: "desc" },
        take: 25,
        include: {
          product: { select: { id: true, name: true } },
          offer: { select: { id: true, name: true } },
          invoices: { select: { id: true, invoiceNumber: true, status: true, totalAmount: true, deletedAt: true } },
          vpsInstance: { select: { id: true, name: true, vmid: true, status: true, ipAddress: true, deletedAt: true } },
          dedicatedService: { select: { id: true, serviceNumber: true, status: true, primaryIp: true } },
        },
      }), warnings, logContext, []),
      guardedRelation("payments", () => prisma.payment.findMany({ where: { customerId: id }, orderBy: { createdAt: "desc" }, take: 25 }), warnings, logContext, []),
      guardedRelation("invoices", () => prisma.invoice.findMany({
        where: { customerId: id, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 25,
        include: {
          order: {
            select: {
              id: true,
              orderNumber: true,
              status: true,
              vpsInstance: { select: { id: true, name: true, vmid: true, status: true } },
            },
          },
        },
      }), warnings, logContext, []),
      guardedRelation("walletTransactions", () => prisma.walletTransaction.findMany({ where: { customerId: id }, orderBy: { createdAt: "desc" }, take: 50 }), warnings, logContext, []),
      guardedRelation("supportTickets", () => prisma.supportTicket.findMany({ where: { customerId: id }, orderBy: { createdAt: "desc" }, take: 25 }), warnings, logContext, []),
      guardedRelation("auditLogs", () => prisma.auditLog.findMany({ where: { customerId: id }, orderBy: { createdAt: "desc" }, take: 100 }), warnings, logContext, []),
      guardedRelation("serviceSpend", () => getCustomerServiceSpendMap([customer.id]), warnings, logContext, new Map<string, number>()),
    ])

    const normalizedOrders = (orders as any[]).map((order) => ({
      ...order,
      invoices: Array.isArray(order.invoices) ? (order.invoices.find((invoice: any) => !invoice?.deletedAt) || null) : (order.invoices || null),
    }))

    const payload = safeJson({
      customer: {
        ...sanitizeCustomer(customer),
        orders: normalizedOrders,
        payments,
        invoices,
        walletTransactions,
        supportTickets,
        auditLogs,
        walletBalance: Number(customer.walletBalance || 0),
        serviceSpend: spend.get(customer.id) || 0,
        paymentsTotal: spend.get(customer.id) || 0,
      },
      warnings,
    })
    await writeStructuredLog("customer-page", "request", {
      ...logContext,
      method: "GET",
      status: 200,
      durationMs: Date.now() - startedAt,
      warningCount: warnings.length,
      response: {
        orders: normalizedOrders.length,
        invoices: (invoices as any[]).length,
        walletTransactions: (walletTransactions as any[]).length,
        auditLogs: (auditLogs as any[]).length,
      },
    })
    return NextResponse.json(payload)
  } catch (error) {
    await writeStructuredLog("customer-page", "request", { ...logContext, method: "GET", status: 500, durationMs: Date.now() - startedAt, failureReason: "customer_request_failed", error })
    await logApiError({ ...logContext, route: "/api/admin/customers/[id]", method: "GET", status: 500, durationMs: Date.now() - startedAt, error })
    return NextResponse.json({
      customer: null,
      warnings: [relationWarning("customer", error)],
      error: "Customer profile could not be loaded safely.",
    }, { status: 200 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const adminRow = await prisma.adminProfile.findUnique({
    where: { email: String(admin.email).toLowerCase() },
    select: { id: true },
  })
  if (!adminRow) return NextResponse.json({ error: "Admin not found" }, { status: 404 })

  const { id } = await params
  const body = (await request.json()) as Record<string, unknown>
  const existing = await prisma.customer.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Customer not found" }, { status: 404 })

  const status = String(body.status || existing.status).toUpperCase()
  if (!["ACTIVE", "SUSPENDED", "PENDING", "BANNED", "CLOSED"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 })
  }

  const nextEmail = normalizeEmail(body.email || existing.email)
  if (!nextEmail || !/^\S+@\S+\.\S+$/.test(nextEmail)) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 })
  }
  if (nextEmail !== existing.email) {
    const duplicate = await prisma.customer.findUnique({ where: { email: nextEmail } })
    if (duplicate && duplicate.id !== id) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 })
    }
  }

  const nextWalletBalance = Number(body.walletBalance ?? existing.walletBalance)
  if (!Number.isFinite(nextWalletBalance) || nextWalletBalance < 0) {
    return NextResponse.json({ error: "Wallet balance must be a non-negative number" }, { status: 400 })
  }

  const walletChanged = Number(existing.walletBalance) !== nextWalletBalance
  const walletReason = String(body.walletReason || body.reason || "").trim()
  if (walletChanged && !walletReason) {
    return NextResponse.json({ error: "Reason is required for wallet balance changes" }, { status: 400 })
  }

  const updated = await prisma.$transaction(async (tx) => {
    let customer = await tx.customer.update({
      where: { id },
      data: {
        name: String(body.name || "").trim() || null,
        email: nextEmail,
        phone: String(body.phone || "").trim() || null,
        company: String(body.company || "").trim() || null,
        internalNotes: String(body.internalNotes || body.notes || "").trim() || null,
        status: status as any,
        isActive: status === "ACTIVE",
        suspendedAt: status === "SUSPENDED" ? (existing.suspendedAt || new Date()) : null,
        suspendedReason: status === "SUSPENDED" ? String(body.suspendedReason || body.reason || "").trim() || null : null,
        suspendMessage: status === "SUSPENDED" ? String(body.suspendMessage || "").trim() || null : null,
      },
    })

    if (walletChanged) {
      const diff = Number((nextWalletBalance - Number(existing.walletBalance)).toFixed(2))
      await createWalletTransaction(tx as any, {
        customerId: id,
        type: diff >= 0 ? "admin_add" : "admin_deduct",
        amount: Math.abs(diff),
        reason: walletReason,
        note: "Wallet balance adjusted from customer edit modal",
        createdByType: "admin",
        createdByAdminId: adminRow.id,
      })
      customer = await tx.customer.findUnique({ where: { id } }) as typeof customer
    }

    await tx.auditLog.create({
      data: {
        adminId: adminRow.id,
        customerId: id,
        action: "CUSTOMER_UPDATED",
        oldValue: JSON.stringify({
          name: existing.name,
          email: existing.email,
          phone: existing.phone,
          company: existing.company,
          walletBalance: Number(existing.walletBalance),
          status: existing.status,
          internalNotes: existing.internalNotes,
        }),
        newValue: JSON.stringify({
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          company: customer.company,
          walletBalance: Number(customer.walletBalance),
          status: customer.status,
          internalNotes: customer.internalNotes,
        }),
        ipAddress: extractClientIp(request),
        userAgent: request.headers.get("user-agent"),
      },
    })

    return customer
  })

  return NextResponse.json({ success: true, customer: updated })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const adminRow = await prisma.adminProfile.findUnique({
    where: { email: String(admin.email).toLowerCase() },
    select: { id: true },
  })
  if (!adminRow) return NextResponse.json({ error: "Admin not found" }, { status: 404 })

  const { id } = await params
  const body = (await request.json()) as Record<string, unknown>
  const section = String(body.section || "profile")

  const existing = await prisma.customer.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Customer not found" }, { status: 404 })

  if (section === "profile") {
    const patch: Record<string, unknown> = {}
    if (typeof body.name === "string") patch.name = body.name.trim() || null
    if (typeof body.phone === "string") patch.phone = body.phone.trim() || null
    if (typeof body.company === "string") patch.company = body.company.trim() || null
    if (typeof body.accountType === "string" && ["INDIVIDUAL", "BUSINESS"].includes(body.accountType)) {
      patch.accountType = body.accountType
    }
    if (typeof body.internalNotes === "string") patch.internalNotes = body.internalNotes
    if (typeof body.creditLimit === "number") patch.creditLimit = body.creditLimit


    if (typeof body.email === "string") {
      const nextEmail = normalizeEmail(body.email)
      if (nextEmail && nextEmail !== existing.email) {
        const duplicate = await prisma.customer.findUnique({ where: { email: nextEmail } })
        if (duplicate && duplicate.id !== id) {
          return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 })
        }
        patch.pendingEmail = nextEmail
      }
    }

    const updated = await prisma.customer.update({ where: { id }, data: patch })

    await createAuditLog({
      adminId: adminRow.id,
      customerId: id,
      action: "CUSTOMER_PROFILE_UPDATED",
      oldValue: { name: existing.name, phone: existing.phone, company: existing.company, email: existing.email },
      newValue: { name: updated.name, phone: updated.phone, company: updated.company, pendingEmail: updated.pendingEmail },
      ipAddress: extractClientIp(request),
      userAgent: request.headers.get("user-agent"),
    })

    return NextResponse.json({ success: true, customer: updated })
  }

  if (section === "address") {
    const parsed = addressSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid address payload" }, { status: 400 })
    }
    let normalized
    try {
      normalized = normalizeBillingAddress({
        addressLine1: parsed.data.addressLine1,
        addressLine2: parsed.data.addressLine2,
        city: parsed.data.city,
        state: parsed.data.state,
        country: parsed.data.country,
        postalCode: parsed.data.postalCode,
      })
    } catch (error: any) {
      if (error?.code === "billing_address_required") {
        return NextResponse.json({
          error: "Complete billing address is required",
          code: "billing_address_required",
          missingFields: Array.isArray(error?.fields) ? error.fields : undefined,
        }, { status: 400 })
      }
      throw error
    }

    const updated = await prisma.customer.update({
      where: { id },
      data: {
        ...parsed.data,
        addressLine1: normalized.addressLine1,
        addressLine2: normalized.addressLine2,
        city: normalized.city,
        state: normalized.state,
        country: normalized.country,
        postalCode: normalized.postalCode,
        gstin: normalized.gstin,
        panNumber: normalized.panNumber,
        address: {
          line1: normalized.addressLine1,
          line2: normalized.addressLine2,
          city: normalized.city,
          state: normalized.state,
          country: normalized.country,
          postalCode: normalized.postalCode,
        } as any,
      },
    })
    await createAuditLog({
      adminId: adminRow.id,
      customerId: id,
      action: "CUSTOMER_ADDRESS_UPDATED",
      oldValue: {
        addressLine1: existing.addressLine1,
        addressLine2: existing.addressLine2,
        city: existing.city,
        state: existing.state,
        postalCode: existing.postalCode,
        country: existing.country,
        gstin: existing.gstin,
        panNumber: existing.panNumber,
      },
      newValue: parsed.data,
      ipAddress: extractClientIp(request),
      userAgent: request.headers.get("user-agent"),
    })

    return NextResponse.json({ success: true, customer: updated })
  }

  if (section === "password") {
    const password = String(body.password || "")
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 })
    }

    const hashed = await bcrypt.hash(password, 10)
    const updated = await prisma.customer.update({ where: { id }, data: { hashedPassword: hashed } })

    const brandName = await getBrandName()
    await Promise.all([
      createAuditLog({
        adminId: adminRow.id,
        customerId: id,
        action: "CUSTOMER_PASSWORD_RESET",
        oldValue: null,
        newValue: { resetByAdmin: String(admin.email) },
        ipAddress: extractClientIp(request),
        userAgent: request.headers.get("user-agent"),
      }),
      sendEmail({
        type: "accounts",
        to: updated.email,
        subject: "Your password was changed",
        text: `Your ${brandName} password was changed by an administrator. If this wasn't expected, contact support immediately.`,
        logMessage: "password reset sent",
        customerId: id,
      }).catch(() => null),
    ])

    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: "Unsupported update section" }, { status: 400 })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const adminRow = await prisma.adminProfile.findUnique({
    where: { email: String(admin.email).toLowerCase() },
    select: { id: true },
  })
  if (!adminRow) return NextResponse.json({ error: "Admin not found" }, { status: 404 })

  const { id } = await params
  const result = await deleteCustomerSafely({
    customerId: id,
    adminId: adminRow.id,
    actorEmail: admin.email,
    ipAddress: extractClientIp(request),
    userAgent: request.headers.get("user-agent"),
  })
  if (result.reason === "not_found") return NextResponse.json({ error: "Customer not found" }, { status: 404 })
  if (!result.deleted) {
    return NextResponse.json({
      success: false,
      code: result.reason || "customer_delete_blocked",
      error: result.reason === "active_orders_or_services"
        ? "Delete or cancel active orders/services before deleting this customer."
        : "Customer cannot be deleted safely.",
      result,
    }, { status: 409 })
  }
  return NextResponse.json({ success: true, result })
}
