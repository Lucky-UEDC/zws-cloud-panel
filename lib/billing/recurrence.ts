import { prisma } from "@/lib/db"
import { withRedisLock } from "@/lib/redis"
import { computePlanQuote, createBackupPlanRenewalOrder } from "@/lib/billing/billable-orders"
import { payBillableOrderFromWallet } from "@/lib/billing/wallet-billable"
import { sendNotification } from "@/lib/notifications/service"
import { createPanelLog } from "@/lib/panel-log"

type RecurrenceResult = {
  checked: number
  autoRenewed: number
  pendingCreated: number
  enteredGrace: number
  expired: number
  upgradesExpired: number
  skipped: number
  errors: string[]
}

function inr(value: unknown): string {
  const n = Number(value || 0)
  return Number.isFinite(n) ? n.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "0.00"
}

function daysFromNow(days: number, from = new Date()): Date {
  const next = new Date(from)
  next.setDate(next.getDate() + days)
  return next
}

function monthsLaterFrom(from: Date, months: number): Date {
  const next = new Date(from)
  next.setMonth(next.getMonth() + Math.max(1, Math.floor(Number(months) || 1)))
  return next
}

async function findRenewalOrder(subscriptionId: string, statuses: string[]) {
  return prisma.order.findFirst({
    where: {
      status: { in: statuses },
      AND: [
        { metadata: { path: ["kind"], equals: "backup_plan_renewal" } },
        { metadata: { path: ["renewalRef", "subscriptionId"], equals: subscriptionId } },
      ],
    },
    orderBy: { createdAt: "desc" },
  }).catch(() => null)
}

async function notifyCustomer(input: {
  customerId: string
  email?: string | null
  phone?: string | null
  name?: string | null
  subject: string
  text: string
  orderId?: string | null
  invoiceId?: string | null
  metadata?: Record<string, unknown>
}) {
  if (!input.email && !input.phone) return null
  return sendNotification({
    type: "notification",
    channels: ["email", "whatsapp"],
    user: { id: input.customerId, email: input.email, phone: input.phone, name: input.name },
    data: {
      subject: input.subject,
      text: input.text,
      message: input.text,
      orderId: input.orderId,
      invoiceId: input.invoiceId,
      metadata: { source: "backup-billing-recurrence", ...(input.metadata || {}) },
    },
  }).catch(() => null)
}

async function renewSubscription(input: { sub: any; now: Date }): Promise<{ action: "renewed" | "pending" | "grace-only" | "skip"; }> {
  const { sub, now } = input
  const plan = sub.plan
  if (!plan) return { action: "skip" }
  const term = Math.max(1, Number(sub.termMonths || 1) || 1)
  const quote = await computePlanQuote({ monthlyPrice: plan.price, termMonths: term, taxPercent: plan.taxPercent })

  const customer = await prisma.customer.findUnique({ where: { id: sub.customerId }, select: { id: true, email: true, phone: true, name: true, walletBalance: true } }).catch(() => null)
  if (!customer) return { action: "skip" }
  const balance = Number(customer.walletBalance || 0)

  const paid = await prisma.order.findFirst({
    where: {
      status: { in: ["paid", "verification_pending"] },
      createdAt: { gte: new Date(now.getTime() - 48 * 60 * 60 * 1000) },
      AND: [
        { metadata: { path: ["kind"], equals: "backup_plan_renewal" } },
        { metadata: { path: ["renewalRef", "subscriptionId"], equals: sub.id } },
      ],
    },
    orderBy: { createdAt: "desc" },
  }).catch(() => null)
  if (paid) return { action: "skip" }

  const pending = await findRenewalOrder(sub.id, ["pending", "awaiting_payment", "incomplete"])
  const target = pending && balance >= quote.total ? pending : null
  if (target) {
    const paidResult = await payBillableOrderFromWallet({
      customerId: sub.customerId,
      order: target,
      idempotencyKey: `billable:${target.id}`,
      actor: "backup-billing-recurrence",
    })
    if (!paidResult.success) return { action: "skip" }
    await createPanelLog({
      category: "Billing",
      message: "backup_plan_renewal_paid_from_grace",
      customerId: sub.customerId,
      orderId: target.id,
      metadata: { subscriptionId: sub.id, paymentId: paidResult.paymentId || null, actor: "backup-billing-recurrence" },
    }).catch(() => null)
    return { action: "renewed" }
  }

  if (balance < quote.total) {
    if (!pending) {
      await createBackupPlanRenewalOrder({ customerId: sub.customerId, subscriptionId: sub.id, termMonths: term }).catch(() => null)
    }
    return { action: "pending" }
  }

  const created = await createBackupPlanRenewalOrder({ customerId: sub.customerId, subscriptionId: sub.id, termMonths: term })
  const paidResult = await payBillableOrderFromWallet({
    customerId: sub.customerId,
    order: created.order,
    idempotencyKey: `billable:${created.order.id}`,
    actor: "backup-billing-recurrence",
  })
  if (!paidResult.success) {
    await notifyCustomer({
      customerId: sub.customerId,
      email: customer.email,
      phone: customer.phone,
      name: customer.name,
      subject: "Backup plan renewal needs payment",
      text: `Your ${plan.name} backup plan renewal could not be completed automatically. Please complete payment from your billing page to keep backups running.`,
      orderId: created.order.id,
      invoiceId: paidResult.invoiceId || null,
      metadata: { subscriptionId: sub.id, amount: inr(quote.total) },
    })
    return { action: "pending" }
  }
  return { action: "renewed" }
}

async function processActiveExpiry(sub: any, now: Date) {
  const plan = sub.plan
  const graceDays = Number(plan?.gracePeriodDays || 3)
  const quote = await computePlanQuote({ monthlyPrice: plan?.price, termMonths: Number(sub.termMonths || 1), taxPercent: plan?.taxPercent })

  if (sub.autoRenew) {
    const outcome = await renewSubscription({ sub, now })
    if (outcome.action === "renewed") return "renewed"
    if (outcome.action === "pending" || outcome.action === "grace-only") {
      const graceEndsAt = daysFromNow(graceDays, now)
      await prisma.backupSubscription.update({
        where: { id: sub.id },
        data: { status: "grace", graceEndsAt, metadata: { ...(sub.metadata && typeof sub.metadata === "object" ? sub.metadata : {}), graceReason: "expired_auto_renew_pending", graceEnteredAt: now.toISOString() } },
      })
      await notifyCustomer({
        customerId: sub.customerId,
        email: sub.customer?.email || null,
        phone: sub.customer?.phone || null,
        name: sub.customer?.name || null,
        subject: "Your backup plan needs renewal",
        text: `Your ${plan?.name || "backup"} plan expired. Renew ₹${inr(quote.total)} within the ${graceDays}-day grace period (${graceEndsAt.toISOString().slice(0, 10)}) to keep backups and restores active.`,
        orderId: null,
        invoiceId: null,
        metadata: { subscriptionId: sub.id, status: "grace", expiresAt: sub.expiresAt?.toISOString() || null },
      })
      return "grace"
    }
    return "skip"
  }

  const graceEndsAt = daysFromNow(graceDays, now)
  await prisma.backupSubscription.update({
    where: { id: sub.id },
    data: { status: "grace", graceEndsAt, metadata: { ...(sub.metadata && typeof sub.metadata === "object" ? sub.metadata : {}), graceReason: "renewal_due", graceEnteredAt: now.toISOString() } },
  })
  await notifyCustomer({
    customerId: sub.customerId,
    email: sub.customer?.email || null,
    phone: sub.customer?.phone || null,
    name: sub.customer?.name || null,
    subject: "Your backup plan is due for renewal",
    text: `Your ${plan?.name || "backup"} plan has entered its grace period until ${graceEndsAt.toISOString().slice(0, 10)}. Renew to continue backing up your servers.`,
    orderId: null,
    invoiceId: null,
    metadata: { subscriptionId: sub.id, status: "grace" },
  })
  return "grace"
}

export async function processBackupBillingRecurrence(options: { now?: Date; emit?: boolean } = {}): Promise<RecurrenceResult> {
  const now = options.now || new Date()
  const emit = options.emit !== false
  const result: RecurrenceResult = { checked: 0, autoRenewed: 0, pendingCreated: 0, enteredGrace: 0, expired: 0, upgradesExpired: 0, skipped: 0, errors: [] }

  await withRedisLock("billing-recurrence:backup", 60000, async () => {
    const dueActive = await prisma.backupSubscription.findMany({
      where: { status: "active", expiresAt: { lte: now } },
      include: { plan: true, customer: true },
    }).catch(() => [])
    result.checked += dueActive.length
    for (const sub of dueActive) {
      try {
        const outcome = await processActiveExpiry(sub, now)
        if (outcome === "renewed") result.autoRenewed += 1
        else if (outcome === "grace") result.enteredGrace += 1
        else result.skipped += 1
      } catch (error: any) {
        result.errors.push(`subscription ${sub.id}: ${error?.message || String(error)}`)
      }
    }

    const graceSubs = await prisma.backupSubscription.findMany({
      where: { status: "grace" },
      include: { plan: true, customer: true },
    }).catch(() => [])
    for (const sub of graceSubs) {
      try {
        result.checked += 1
        const gracePassed = sub.graceEndsAt != null && sub.graceEndsAt <= now
        if (gracePassed) {
          await prisma.backupSubscription.update({
            where: { id: sub.id },
            data: { status: "expired", metadata: { ...(sub.metadata && typeof sub.metadata === "object" ? sub.metadata : {}), expiredAt: now.toISOString(), expiredReason: "grace_period_elapsed" } },
          })
          await notifyCustomer({
            customerId: sub.customerId,
            email: sub.customer?.email || null,
            phone: sub.customer?.phone || null,
            name: sub.customer?.name || null,
            subject: "Your backup plan has expired",
            text: `Your ${sub.plan?.name || "backup"} plan expired on ${sub.expiresAt ? sub.expiresAt.toISOString().slice(0, 10) : "recently"}. Backups are paused until you purchase a new plan.`,
            orderId: null,
            invoiceId: null,
            metadata: { subscriptionId: sub.id, status: "expired" },
          })
          result.expired += 1
          continue
        }
        if (sub.autoRenew) {
          const outcome = await renewSubscription({ sub, now })
          if (outcome.action === "renewed") result.autoRenewed += 1
        }
      } catch (error: any) {
        result.errors.push(`grace ${sub.id}: ${error?.message || String(error)}`)
      }
    }

    const dueUpgrades = await prisma.backupStorageUpgrade.findMany({
      where: { status: "active", expiresAt: { lte: now } },
      include: { subscription: true, customer: true },
    }).catch(() => [])
    for (const upgrade of dueUpgrades) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.backupStorageUpgrade.update({
            where: { id: upgrade.id },
            data: { status: "expired" },
          })
          const sub = upgrade.subscription
          if (sub) {
            const current = Math.max(0, Number(sub.upgradeStorageGb || 0))
            const gb = Math.max(0, Math.floor(Number(upgrade.gb) || 0))
            await tx.backupSubscription.update({
              where: { id: sub.id },
              data: { upgradeStorageGb: Math.max(0, current - gb) },
            })
          }
        })
        await notifyCustomer({
          customerId: upgrade.customerId,
          email: upgrade.customer?.email || null,
          phone: upgrade.customer?.phone || null,
          name: upgrade.customer?.name || null,
          subject: "Extra backup storage expired",
          text: `Your ${inr(upgrade.gb)} GB extra backup storage expired. Your plan quota has been restored to the base limit.`,
          orderId: upgrade.orderId || null,
          invoiceId: upgrade.invoiceId || null,
          metadata: { subscriptionId: upgrade.subscriptionId, upgradeId: upgrade.id, gb: upgrade.gb, status: "expired" },
        })
        result.upgradesExpired += 1
      } catch (error: any) {
        result.errors.push(`upgrade ${upgrade.id}: ${error?.message || String(error)}`)
      }
    }
  })

  return result
}