import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { getTaxPolicy } from "@/lib/tax-engine"
import { money, round2, mulAmount, add } from "@/lib/billing/money"

export type PlanQuote = {
  subtotal: number
  discount: number
  taxableAmount: number
  taxPercent: number
  gst: number
  total: number
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

export async function computePlanQuote(input: {
  monthlyPrice?: number | string | Prisma.Decimal | null
  termMonths?: number
  taxPercent?: number | string | Prisma.Decimal | null
  countryCode?: string | null
}): Promise<PlanQuote> {
  const price = money(input.monthlyPrice ?? 0)
  const term = Math.max(1, Number(input.termMonths || 1) || 1)
  const subtotal = round2(mulAmount(price, term))
  const taxPolicy = getTaxPolicy(input.countryCode || null)
  const taxPercent = input.taxPercent != null && money(input.taxPercent) > 0
    ? money(input.taxPercent)
    : round2(taxPolicy.percent ?? 0)
  const gst = round2(mulAmount(subtotal, taxPercent / 100))
  const total = round2(add(subtotal, gst))
  return { subtotal, discount: 0, taxableAmount: subtotal, taxPercent, gst, total }
}

function generateBillableOrderNumber(kind: string): string {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).substring(2, 6).toUpperCase()
  const prefix = String(kind || "BL")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 6)
    .toUpperCase()
  return `ZWS-${prefix}-${timestamp}-${random}`
}

async function createCustomerMetadataSnapshot(customerId: string): Promise<Record<string, unknown>> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      name: true,
      email: true,
      phone: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
      gstin: true,
      panNumber: true,
    },
  })
  return {
    customerDetails: customer ? {
      name: customer.name,
      email: customer.email,
      phone: customer.phone || null,
      company: null,
    } : null,
    billingAddress: customer ? {
      name: customer.name || "Customer",
      email: customer.email,
      phone: customer.phone || null,
      addressLine1: customer.addressLine1 || "Address not provided",
      addressLine2: customer.addressLine2 || null,
      city: customer.city || "Unknown",
      state: customer.state || "Unknown",
      postalCode: customer.postalCode || "000000",
      country: customer.country || "India",
      gstin: customer.gstin || null,
      panNumber: customer.panNumber || null,
    } : null,
  }
}

export async function createBackupPlanOrder(input: {
  customerId: string
  planId: string
  termMonths?: number
}): Promise<{ order: any; quote: PlanQuote }> {
  const plan = await prisma.backupPlan.findUnique({ where: { id: input.planId } })
  if (!plan) throw new Error("Backup plan not found")
  if (!plan.active || plan.archived) throw new Error("This backup plan is not available for purchase")

  const term = Math.max(1, Number(input.termMonths || 1) || 1)
  const quote = await computePlanQuote({ monthlyPrice: plan.price, termMonths: term, taxPercent: plan.taxPercent })
  const planRef = {
    planId: plan.id,
    slug: plan.slug,
    name: plan.name,
    price: money(plan.price),
    termMonths: term,
    maxBackups: plan.maxBackups,
    storageQuotaGb: plan.storageQuotaGb,
    retentionCount: plan.retentionCount,
    autoRenew: true,
  }
  const orderNumber = generateBillableOrderNumber("backup-plan")
  const customerSnapshot = await createCustomerMetadataSnapshot(input.customerId)

  const order = await prisma.order.create({
    data: {
      orderNumber,
      customerId: input.customerId,
      unitPrice: quote.total,
      quantity: 1,
      subtotal: quote.subtotal,
      taxAmount: quote.gst,
      discountAmount: 0,
      totalAmount: quote.total,
      originalAmount: quote.total,
      finalAmount: quote.total,
      payableAmount: quote.total,
      termMonths: term,
      currency: "INR",
      status: "pending",
      metadata: {
        kind: "backup_plan",
        productName: `${plan.name} Backup Plan`,
        billable: true,
        termMonths: term,
        planRef,
        pricingSnapshot: {
          subtotal: quote.subtotal,
          discount: 0,
          discountPercent: 0,
          taxableAmount: quote.taxableAmount,
          taxPercent: quote.taxPercent,
          taxLabel: "GST",
          gst: quote.gst,
          total: quote.total,
        },
        ...customerSnapshot,
      } as any,
    },
  })
  return { order, quote }
}

export async function createBackupPlanRenewalOrder(input: {
  customerId: string
  subscriptionId: string
  termMonths?: number
}): Promise<{ order: any; quote: PlanQuote }> {
  const subscription = await prisma.backupSubscription.findUnique({ where: { id: input.subscriptionId }, include: { plan: true } })
  if (!subscription || subscription.customerId !== input.customerId) throw new Error("Backup subscription not found")
  if (subscription.status !== "active" && subscription.status !== "grace") throw new Error("Backup subscription is not renewable")
  const plan = subscription.plan
  if (!plan.active || plan.archived) throw new Error("This backup plan is no longer available for renewal")

  const term = Math.max(1, Number(input.termMonths || subscription.termMonths || 1) || 1)
  const quote = await computePlanQuote({ monthlyPrice: plan.price, termMonths: term, taxPercent: plan.taxPercent })
  const planRef = {
    planId: plan.id,
    slug: plan.slug,
    name: plan.name,
    price: money(plan.price),
    termMonths: term,
    maxBackups: plan.maxBackups,
    storageQuotaGb: plan.storageQuotaGb,
    retentionCount: plan.retentionCount,
    autoRenew: true,
  }
  const orderNumber = generateBillableOrderNumber("backup-renewal")
  const customerSnapshot = await createCustomerMetadataSnapshot(input.customerId)
  const order = await prisma.order.create({
    data: {
      orderNumber,
      customerId: input.customerId,
      unitPrice: quote.total,
      quantity: 1,
      subtotal: quote.subtotal,
      taxAmount: quote.gst,
      discountAmount: 0,
      totalAmount: quote.total,
      originalAmount: quote.total,
      finalAmount: quote.total,
      payableAmount: quote.total,
      termMonths: term,
      currency: "INR",
      status: "pending",
      metadata: {
        kind: "backup_plan_renewal",
        productName: `${plan.name} Backup Plan (Renewal)`,
        billable: true,
        termMonths: term,
        planRef,
        renewalRef: {
          subscriptionId: subscription.id,
          previousExpiresAt: subscription.expiresAt ? subscription.expiresAt.toISOString() : null,
          period: Number(record(subscription.metadata).renewalCount || 0) + 1,
        },
        pricingSnapshot: {
          subtotal: quote.subtotal,
          discount: 0,
          discountPercent: 0,
          taxableAmount: quote.taxableAmount,
          taxPercent: quote.taxPercent,
          taxLabel: "GST",
          gst: quote.gst,
          total: quote.total,
        },
        ...customerSnapshot,
      } as any,
    },
  })
  return { order, quote }
}

export type StorageUpgradeOrderInput = {
  customerId: string
  subscriptionId: string
  gb: number
  pricePerGb: number
  termMonths?: number
}

export async function createBackupStorageUpgradeOrder(input: StorageUpgradeOrderInput): Promise<{ order: any; quote: PlanQuote }> {
  const subscription = await prisma.backupSubscription.findUnique({ where: { id: input.subscriptionId } })
  if (!subscription || subscription.customerId !== input.customerId) throw new Error("Backup subscription not found")
  if (!["active", "grace"].includes(subscription.status)) throw new Error("Your backup plan is not active")

  const gb = Math.max(1, Math.floor(Number(input.gb) || 0))
  const pricePerGb = money(input.pricePerGb || 0)
  if (pricePerGb <= 0) throw new Error("Invalid extra storage price")
  const term = Math.max(1, Number(input.termMonths || 1) || 1)

  const subtotal = round2(mulAmount(pricePerGb, gb * term))
  const tax = await getTaxPolicy(null)
  const quote: PlanQuote = { subtotal, discount: 0, taxableAmount: subtotal, taxPercent: round2(tax.percent ?? 18), gst: round2(mulAmount(subtotal, (tax.percent ?? 18) / 100)), total: 0 }
  quote.total = round2(add(quote.subtotal, quote.gst))

  const orderNumber = generateBillableOrderNumber("storage-upgrade")
  const customerSnapshot = await createCustomerMetadataSnapshot(input.customerId)
  const order = await prisma.order.create({
    data: {
      orderNumber,
      customerId: input.customerId,
      unitPrice: quote.total,
      quantity: 1,
      subtotal: quote.subtotal,
      taxAmount: quote.gst,
      discountAmount: 0,
      totalAmount: quote.total,
      originalAmount: quote.total,
      finalAmount: quote.total,
      payableAmount: quote.total,
      termMonths: term,
      currency: "INR",
      status: "pending",
      metadata: {
        kind: "backup_storage_upgrade",
        productName: `Extra Backup Storage (${gb} GB)`,
        billable: true,
        termMonths: term,
        storageUpgradeRef: { subscriptionId: subscription.id, gb, pricePerGb, termMonths: term, planId: subscription.planId },
        pricingSnapshot: {
          subtotal: quote.subtotal,
          discount: 0,
          discountPercent: 0,
          taxableAmount: quote.taxableAmount,
          taxPercent: quote.taxPercent,
          taxLabel: "GST",
          gst: quote.gst,
          total: quote.total,
        },
        ...customerSnapshot,
      } as any,
    },
  })
  return { order, quote }
}

export type SnapshotChargeOrderInput = {
  customerId: string
  vpsInstanceId: string
  name: string
  description?: string
  vmstate?: boolean
  nodeId: string
  vmid: number
  amount: number
  taxAmount: number
  totalAmount: number
  gstRate?: number
  simulateFailure?: boolean
}

export async function createSnapshotChargeOrder(input: SnapshotChargeOrderInput): Promise<{ order: any; chargeId: string }> {
  const instance = await prisma.vpsInstance.findFirst({
    where: { id: input.vpsInstanceId, customerId: input.customerId, deletedAt: null },
    select: { id: true },
  })
  if (!instance) throw new Error("Server not found")
  if (!input.name || !/^[A-Za-z0-9._-]{1,64}$/.test(input.name)) throw new Error("Snapshot name is required")
  if (input.name === "current" || input.name === "root") throw new Error(`Snapshot name "${input.name}" is reserved`)

  const amount = money(input.amount)
  const taxAmount = money(input.taxAmount)
  const totalAmount = money(input.totalAmount)
  if (totalAmount <= 0) throw new Error("Invalid snapshot charge")

  const existingName = await prisma.snapshotCharge.findFirst({
    where: { vpsInstanceId: input.vpsInstanceId, snapshotName: input.name, status: { in: ["unpaid", "paid"] } },
    orderBy: { createdAt: "desc" },
  })
  if (existingName && existingName.status === "unpaid" && existingName.orderId) {
    return { order: existingName.orderId ? await prisma.order.findUnique({ where: { id: existingName.orderId } }) : null, chargeId: existingName.id }
  }

  const orderNumber = generateBillableOrderNumber("snapshot")
  const customerSnapshot = await createCustomerMetadataSnapshot(input.customerId)
  const order = await prisma.order.create({
    data: {
      orderNumber,
      customerId: input.customerId,
      unitPrice: totalAmount,
      quantity: 1,
      subtotal: amount,
      taxAmount,
      discountAmount: 0,
      totalAmount,
      originalAmount: totalAmount,
      finalAmount: totalAmount,
      payableAmount: totalAmount,
      termMonths: 1,
      currency: "INR",
      status: "pending",
      metadata: {
        kind: "snapshot_charge",
        productName: `Snapshot "${input.name}"`,
        billable: true,
        snapshotIntent: {
          vpsInstanceId: input.vpsInstanceId,
          nodeId: input.nodeId,
          vmid: input.vmid,
          name: input.name,
          description: input.description || null,
          vmstate: Boolean(input.vmstate),
          gstRate: input.gstRate ?? null,
          simulateFailure: Boolean(input.simulateFailure),
        },
        pricingSnapshot: {
          subtotal: amount,
          discount: 0,
          discountPercent: 0,
          taxableAmount: amount,
          taxPercent: input.gstRate ?? (totalAmount > amount ? round2((taxAmount / (totalAmount - taxAmount)) * 100) : 0),
          taxLabel: "GST",
          gst: taxAmount,
          total: totalAmount,
        },
        ...customerSnapshot,
      } as any,
    },
  })

  const charge = await prisma.snapshotCharge.create({
    data: {
      customerId: input.customerId,
      vpsInstanceId: input.vpsInstanceId,
      orderId: order.id,
      amount,
      taxAmount,
      totalAmount,
      currency: "INR",
      status: "unpaid",
      snapshotName: input.name,
      metadata: {
        kind: "snapshot_charge",
        lifecycle: "REQUESTED",
        gstRate: input.gstRate ?? null,
        snapshotIntent: { ...((order.metadata as any)?.snapshotIntent || {}) },
      } as any,
    },
  })

  return { order, chargeId: charge.id }
}