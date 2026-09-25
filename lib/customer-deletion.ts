import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { writeAuditLog } from "@/lib/audit-log"
import { createPanelLog } from "@/lib/panel-log"
import { deleteInvoicesPermanently } from "@/lib/invoice-deletion"

const ACTIVE_ORDER_STATUSES = new Set(["pending", "pending_payment", "paid", "payment_verified", "verification_pending", "provisioning", "active", "completed"])
const LIVE_SERVICE_STATUSES = new Set(["active", "running", "stopped", "suspended", "installing", "provisioning", "pending_termination"])

function normalized(value: unknown) {
  return String(value || "").trim().toLowerCase()
}

function isActiveOrder(order: { status?: string | null; deletedAt?: Date | string | null; isActive?: boolean | null }) {
  return !order.deletedAt && order.isActive !== false && ACTIVE_ORDER_STATUSES.has(normalized(order.status))
}

function isLiveVps(vps: { status?: string | null; deletedAt?: Date | string | null } | null | undefined) {
  if (!vps || vps.deletedAt) return false
  return LIVE_SERVICE_STATUSES.has(normalized(vps.status))
}

function isLiveDedicated(service: { status?: string | null } | null | undefined) {
  if (!service) return false
  return LIVE_SERVICE_STATUSES.has(normalized(service.status))
}

export type CustomerDeletionResult = {
  deleted: boolean
  customerId: string
  blocked: boolean
  reason?: string
  blockers?: Array<{ type: string; id: string; status?: string | null }>
}

async function deleteOptionalDelegate(tx: Prisma.TransactionClient, delegateName: string, method: "deleteMany" | "updateMany", args: any) {
  const delegate = (tx as any)[delegateName]
  if (!delegate || typeof delegate[method] !== "function") return null
  return delegate[method](args).catch(() => null)
}

export async function deleteCustomerSafely(input: {
  customerId: string
  adminId?: string | null
  actorEmail?: string | null
  ipAddress?: string | null
  userAgent?: string | null
}): Promise<CustomerDeletionResult> {
  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    include: {
      orders: {
        include: {
          vpsInstance: { select: { id: true, status: true, deletedAt: true } },
          dedicatedService: { select: { id: true, status: true } },
        },
      },
      invoices: { select: { id: true } },
    },
  })

  if (!customer) {
    return { deleted: false, customerId: input.customerId, blocked: false, reason: "not_found" }
  }

  const blockers = customer.orders.flatMap((order) => {
    const rows: Array<{ type: string; id: string; status?: string | null }> = []
    if (isActiveOrder(order)) rows.push({ type: "order", id: order.id, status: order.status })
    if (isLiveVps(order.vpsInstance)) rows.push({ type: "vps", id: order.vpsInstance!.id, status: order.vpsInstance!.status })
    if (isLiveDedicated(order.dedicatedService)) rows.push({ type: "dedicated_service", id: order.dedicatedService!.id, status: order.dedicatedService!.status })
    return rows
  })

  if (blockers.length) {
    await writeAuditLog({
      action: "CUSTOMER_DELETE_BLOCKED",
      adminId: input.adminId || null,
      actorEmail: input.actorEmail || null,
      customerId: customer.id,
      targetType: "customer",
      targetId: customer.id,
      oldValue: { email: customer.email, name: customer.name },
      metadata: { blockers },
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent || null,
    }).catch(() => null)
    return { deleted: false, customerId: customer.id, blocked: true, reason: "active_orders_or_services", blockers }
  }

  const invoiceIds = customer.invoices.map((invoice) => invoice.id)
  if (invoiceIds.length) await deleteInvoicesPermanently(invoiceIds)

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        adminId: input.adminId || null,
        actorEmail: input.actorEmail || null,
        customerId: null,
        targetType: "customer",
        targetId: customer.id,
        action: "CUSTOMER_DELETE_REQUESTED",
        oldValue: JSON.stringify({ email: customer.email, name: customer.name }),
        newValue: JSON.stringify({ deletedBy: input.actorEmail || "admin" }),
        metadata: { source: "deleteCustomerSafely" } as any,
        ipAddress: input.ipAddress || null,
        userAgent: input.userAgent || null,
      },
    })

    await tx.session.deleteMany({ where: { userId: customer.id, role: "client" } }).catch(() => null)
    await tx.authChallenge.deleteMany({ where: { userType: "customer", userId: customer.id } }).catch(() => null)
    await tx.passwordResetToken.deleteMany({ where: { customerId: customer.id } }).catch(() => null)
    await deleteOptionalDelegate(tx, "emailVerificationToken", "deleteMany", { where: { userId: customer.id } })
    await deleteOptionalDelegate(tx, "userLoginSession", "deleteMany", { where: { userId: customer.id, userType: "customer" } })
    await deleteOptionalDelegate(tx, "userSecurityEvent", "deleteMany", { where: { userId: customer.id, userType: "customer" } })
    await deleteOptionalDelegate(tx, "userTrustedDevice", "deleteMany", { where: { userId: customer.id, userType: "customer" } })
    await deleteOptionalDelegate(tx, "userMfaSetting", "deleteMany", { where: { userId: customer.id, userType: "customer" } })
    await deleteOptionalDelegate(tx, "userBackupCode", "deleteMany", { where: { userId: customer.id, userType: "customer" } })

    await deleteOptionalDelegate(tx, "supportTicketAttachment", "deleteMany", { where: { customerId: customer.id } })
    await tx.supportTicketMessage.deleteMany({ where: { customerId: customer.id } }).catch(() => null)
    await tx.supportTicket.deleteMany({ where: { customerId: customer.id } }).catch(() => null)
    await tx.walletTransaction.deleteMany({ where: { customerId: customer.id } }).catch(() => null)
    await tx.payment.deleteMany({ where: { customerId: customer.id } }).catch(() => null)
    await tx.paymentAttempt.deleteMany({ where: { userId: customer.id } }).catch(() => null)
    await tx.checkoutIntent.deleteMany({ where: { customerId: customer.id } }).catch(() => null)
    await tx.checkoutSession.deleteMany({ where: { customerId: customer.id } }).catch(() => null)
    await tx.couponRedemption.deleteMany({ where: { customerId: customer.id } }).catch(() => null)
    await tx.provisioningTaskLog.deleteMany({ where: { job: { customerId: customer.id } } }).catch(() => null)
    await tx.provisioningTaskStep.deleteMany({ where: { job: { customerId: customer.id } } }).catch(() => null)
    await tx.provisioningJob.deleteMany({ where: { customerId: customer.id } }).catch(() => null)
    await tx.vmActionJob.deleteMany({ where: { customerId: customer.id } }).catch(() => null)
    await tx.vpsInstance.deleteMany({ where: { customerId: customer.id } }).catch(() => null)
    await tx.dedicatedService.deleteMany({ where: { customerId: customer.id } }).catch(() => null)
    await tx.invoice.deleteMany({ where: { customerId: customer.id } }).catch(() => null)
    await tx.order.deleteMany({ where: { customerId: customer.id } }).catch(() => null)
    await tx.customConfig.deleteMany({ where: { customerId: customer.id } }).catch(() => null)
    await tx.sshKey.deleteMany({ where: { customerId: customer.id } }).catch(() => null)
    await deleteOptionalDelegate(tx, "customerNotificationPreference", "deleteMany", { where: { customerId: customer.id } })
    await deleteOptionalDelegate(tx, "whatsAppMessageLog", "updateMany", { where: { customerId: customer.id }, data: { customerId: null } })
    await tx.dedicatedInquiry.updateMany({ where: { customerId: customer.id }, data: { customerId: null } }).catch(() => null)
    await tx.auditLog.deleteMany({ where: { customerId: customer.id } }).catch(() => null)
    await tx.adminCustomerImpersonationToken.deleteMany({ where: { customerId: customer.id } }).catch(() => null)
    await tx.customer.delete({ where: { id: customer.id } })
  })

  await createPanelLog({
    category: "Admin Action",
    message: "customer_deleted",
    actorType: "admin",
    actorEmail: input.actorEmail || null,
    metadata: { customerId: customer.id, email: customer.email },
  }).catch(() => null)

  return { deleted: true, customerId: customer.id, blocked: false }
}
