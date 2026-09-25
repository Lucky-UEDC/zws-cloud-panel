import { randomUUID } from "crypto"
import { prisma } from "@/lib/db"
import { withRedisLock } from "@/lib/redis"
import { createPanelLog } from "@/lib/panel-log"
import { runOperationBackground } from "@/lib/operation-progress"
import { createVmSnapshot } from "@/lib/proxmox-snapshots"
import { orderKind, isBillableOrder } from "@/lib/billing/kinds"
import { money } from "@/lib/billing/money"
import { createWalletTransaction } from "@/lib/wallet"
import { writeAuditLog } from "@/lib/audit-log"

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

type SettleInput = {
  order: any
  paymentId?: string | null
  invoiceId?: string | null
  actor?: string
}

function monthsLater(termMonths: number): Date {
  const next = new Date()
  next.setMonth(next.getMonth() + Math.max(1, Math.floor(Number(termMonths) || 1)))
  return next
}

async function settleBackupPlan(order: any, input: SettleInput) {
  const metadata = record(order.metadata)
  const planRef = record(metadata.planRef)
  if (!planRef.planId) return { settled: false, reason: "plan_ref_missing" }

  const plan = await prisma.backupPlan.findUnique({ where: { id: planRef.planId } })
  if (!plan) return { settled: false, reason: "plan_missing" }

  const now = new Date()
  const expiresAt = monthsLater(Number(planRef.termMonths || metadata.termMonths || 1))
  const graceEndsAt = new Date(expiresAt.getTime())
  graceEndsAt.setDate(graceEndsAt.getDate() + Number(plan.gracePeriodDays || 3))

  const existingOrderSubscription = await prisma.backupSubscription.findFirst({ where: { orderId: order.id } }).catch(() => null)
  if (existingOrderSubscription) {
    return { settled: true, reused: true, subscriptionId: existingOrderSubscription.id }
  }

  const actor = input.actor || "system"
  let subscriptionId: string | null = null
  await prisma.$transaction(async (tx) => {
    const existing = await tx.backupSubscription.findFirst({
      where: { customerId: order.customerId, status: { in: ["active", "grace"] } },
      orderBy: { createdAt: "desc" },
    })
    if (existing) {
      const updated = await tx.backupSubscription.update({
        where: { id: existing.id },
        data: {
          planId: plan.id,
          orderId: order.id,
          invoiceId: input.invoiceId || null,
          status: "active",
          startedAt: now,
          expiresAt,
          graceEndsAt,
          autoRenew: true,
          termMonths: Number(planRef.termMonths || 1),
          metadata: { ...record(existing.metadata), switchedFrom: existing.planId, switchedAt: now.toISOString(), actor },
        },
      })
      subscriptionId = updated.id
    } else {
      const created = await tx.backupSubscription.create({
        data: {
          customerId: order.customerId,
          planId: plan.id,
          orderId: order.id,
          invoiceId: input.invoiceId || null,
          status: "active",
          startedAt: now,
          expiresAt,
          graceEndsAt,
          autoRenew: true,
          termMonths: Number(planRef.termMonths || 1),
          metadata: { actor, purchasedAt: now.toISOString() },
        },
      })
      subscriptionId = created.id
    }
  })

  await createPanelLog({
    category: "Billing",
    message: "backup_plan_activated",
    customerId: order.customerId,
    orderId: order.id,
    paymentId: input.paymentId || null,
    metadata: { planId: plan.id, planName: plan.name, subscriptionId, actor },
  }).catch(() => null)

  return { settled: true, subscriptionId }
}

function monthsLaterFrom(from: Date, termMonths: number): Date {
  const next = new Date(from)
  next.setMonth(next.getMonth() + Math.max(1, Math.floor(Number(termMonths) || 1)))
  return next
}

async function settleBackupPlanRenewal(order: any, input: SettleInput) {
  const metadata = record(order.metadata)
  const renewalRef = record(metadata.renewalRef)
  const subscriptionId = String(renewalRef.subscriptionId || "")
  if (!subscriptionId) return { settled: false, reason: "renewal_ref_missing" }

  const subscription = await prisma.backupSubscription.findUnique({ where: { id: subscriptionId } })
  if (!subscription || subscription.customerId !== order.customerId) {
    return { settled: false, reason: "subscription_not_found" }
  }

  const existingOrderSubscription = await prisma.backupSubscription.findFirst({ where: { orderId: order.id } }).catch(() => null)
  if (existingOrderSubscription && existingOrderSubscription.id === subscriptionId && existingOrderSubscription.status !== "expired") {
    return { settled: true, reused: true, subscriptionId: existingOrderSubscription.id }
  }

  const actor = input.actor || "system"
  const now = new Date()
  const term = Math.max(1, Number(order.termMonths || metadata.termMonths || subscription.termMonths || 1) || 1)
  const base = subscription.expiresAt && subscription.expiresAt.getTime() > now.getTime() ? subscription.expiresAt : now
  const expiresAt = monthsLaterFrom(base, term)
  const planGraceDays = Number((await prisma.backupPlan.findUnique({ where: { id: subscription.planId }, select: { gracePeriodDays: true } }).catch(() => null))?.gracePeriodDays ?? 3)
  const graceEndsAt = new Date(expiresAt.getTime())
  graceEndsAt.setDate(graceEndsAt.getDate() + planGraceDays)

  await prisma.$transaction(async (tx) => {
    const meta = record(subscription.metadata)
    await tx.backupSubscription.update({
      where: { id: subscriptionId },
      data: {
        planId: subscription.planId,
        orderId: order.id,
        invoiceId: input.invoiceId || null,
        status: "active",
        expiresAt,
        graceEndsAt,
        autoRenew: Boolean(subscription.autoRenew ?? true),
        termMonths: term,
        metadata: {
          ...meta,
          lastRenewalAt: now.toISOString(),
          lastRenewalOrderId: order.id,
          renewalCount: Number(meta.renewalCount || 0) + 1,
        },
      },
    })
  })

  await createPanelLog({
    category: "Billing",
    message: "backup_plan_renewed",
    customerId: order.customerId,
    orderId: order.id,
    paymentId: input.paymentId || null,
    metadata: { subscriptionId, planId: subscription.planId, expiresAt: expiresAt.toISOString(), actor },
  }).catch(() => null)

  return { settled: true, subscriptionId, extendsTo: expiresAt.toISOString() }
}

async function settleBackupStorageUpgrade(order: any, input: SettleInput) {
  const metadata = record(order.metadata)
  const upgradeRef = record(metadata.storageUpgradeRef)
  const subscriptionId = String(upgradeRef.subscriptionId || "")
  const gb = Math.max(1, Math.floor(Number(upgradeRef.gb) || 0))
  const pricePerGb = money(upgradeRef.pricePerGb || 0)
  if (!subscriptionId) return { settled: false, reason: "subscription_missing" }

  const subscription = await prisma.backupSubscription.findUnique({ where: { id: subscriptionId } })
  if (!subscription || subscription.customerId !== order.customerId) return { settled: false, reason: "subscription_not_found" }

  const existingUpgrade = await prisma.backupStorageUpgrade.findFirst({ where: { orderId: order.id } }).catch(() => null)
  if (existingUpgrade) return { settled: true, reused: true }

  const actor = input.actor || "system"
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.backupStorageUpgrade.create({
      data: {
        customerId: order.customerId,
        subscriptionId,
        gb,
        pricePerGb,
        amount: money(order.totalAmount || order.payableAmount || 0),
        termMonths: Math.max(1, Number(upgradeRef.termMonths || order.termMonths || 1)),
        orderId: order.id,
        invoiceId: input.invoiceId || null,
        status: "active",
        effectiveAt: now,
        expiresAt: monthsLater(Number(upgradeRef.termMonths || 1)),
      },
    })
    await tx.backupSubscription.update({
      where: { id: subscriptionId },
      data: { upgradeStorageGb: { increment: gb }, extraStoragePricePerGb: pricePerGb },
    })
  })

  await createPanelLog({
    category: "Billing",
    message: "backup_storage_upgrade_activated",
    customerId: order.customerId,
    orderId: order.id,
    paymentId: input.paymentId || null,
    metadata: { subscriptionId, gb, pricePerGb, actor },
  }).catch(() => null)

  return { settled: true }
}

async function settleSnapshotCharge(order: any, input: SettleInput) {
  const metadata = record(order.metadata)
  const intent = record(metadata.snapshotIntent)
  const name = String(intent.name || "")
  const vpsInstanceId = String(intent.vpsInstanceId || order.metadata?.snapshotIntent?.vpsInstanceId || "")
  if (!name || !vpsInstanceId) return { settled: false, reason: "snapshot_intent_missing" }

  const existingCharges = await prisma.snapshotCharge.findMany({
    where: { orderId: order.id },
    orderBy: { createdAt: "desc" },
    take: 1,
  })
  let charge = existingCharges[0] || null
  if (!charge) {
    charge = await prisma.snapshotCharge.create({
      data: {
        customerId: order.customerId,
        vpsInstanceId,
        orderId: order.id,
        invoiceId: input.invoiceId || null,
        amount: money(order.subtotal || order.unitPrice || 0),
        taxAmount: money(order.taxAmount || 0),
        totalAmount: money(order.totalAmount || order.payableAmount || 0),
        currency: "INR",
        status: "paid",
        snapshotName: name,
        metadata: { kind: "snapshot_charge", lifecycle: "PAID", snapshotIntent: intent, paidBy: input.actor || "system" } as any,
      },
    })
  } else {
    charge = await prisma.snapshotCharge.update({
      where: { id: charge.id },
      data: {
        status: "paid",
        invoiceId: input.invoiceId || charge.invoiceId,
        metadata: { ...record(charge.metadata), lifecycle: "PAID", paidBy: input.actor || "system", paidAt: new Date().toISOString() } as any,
      },
    })
  }

  const chargeMetadata = record(charge.metadata)
  const alreadyRunning = charge.snapshotId != null || Boolean(chargeMetadata.snapshotDbId) || Boolean(chargeMetadata.operationId) || Boolean(chargeMetadata.refundedAt)
  if (alreadyRunning) {
    return { settled: true, reused: true, chargeId: charge.id, operationId: chargeMetadata.operationId || null }
  }

  const operationId = randomUUID()
  const actor = input.actor || "system"
  const nodeName = await prisma.proxmoxNode.findUnique({ where: { id: intent.nodeId }, select: { nodeName: true } }).catch(() => null)
  runOperationBackground({
    operationId,
    kind: "snapshot",
    vpsInstanceId,
    customerId: order.customerId,
    vmId: Number(intent.vmid || 0),
    headline: `Creating snapshot "${name}"`,
    nodeName: nodeName?.nodeName || undefined,
    run: async (report) => {
      report({ phase: "Creating snapshot", status: "running" as const })
      await prisma.snapshotCharge.update({
        where: { id: charge!.id },
        data: { metadata: { ...record(charge!.metadata), lifecycle: "CREATING", operationId } as any },
      }).catch(() => null)
      try {
        if (Boolean(intent.simulateFailure)) {
          throw new Error("SIMULATED_SNAPSHOT_FAILURE: injected test failure after payment authorization")
        }
        const result = await createVmSnapshot({ nodeId: intent.nodeId, vmid: Number(intent.vmid || 0), name, description: intent.description || undefined, vmstate: Boolean(intent.vmstate), actor: "client" })
        report({ phase: "Snapshot created", status: "completed" as const, result: { snapshot: result.snapshot } })
        await prisma.snapshotCharge.update({
          where: { id: charge!.id },
          data: { snapshotId: result.dbId || null, status: "paid", metadata: { ...record(charge!.metadata), lifecycle: "COMPLETED", operationId, snapshotDbId: result.dbId || null, snapshotName: name, completedAt: new Date().toISOString() } as any },
        }).catch(() => null)
        await createPanelLog({
          category: "Billing",
          message: "snapshot_charge_activated",
          customerId: order.customerId,
          orderId: order.id,
          paymentId: input.paymentId || null,
          metadata: { snapshotName: name, snapshotDbId: result.dbId || null, operationId, actor },
        }).catch(() => null)
      } catch (error: any) {
        report({ phase: "Snapshot creation failed", status: "failed" as const, error: String(error?.message || "unknown") })
        await handleSnapshotChargeFailure({ chargeId: charge!.id, orderId: order.id, paymentId: input.paymentId || null, customerId: order.customerId, snapshotName: name, error, actor })
        throw error
      }
    },
  })

  return { settled: true, operationId, chargeId: charge.id }
}

async function handleSnapshotChargeFailure(input: { chargeId: string; orderId: string; paymentId?: string | null; customerId: string; snapshotName: string; error: any; actor: string }) {
  const { chargeId, orderId, customerId, snapshotName, error, actor } = input
  const message = String(error?.message || "Snapshot creation failed")

  const payment = input.paymentId
    ? await prisma.payment.findUnique({ where: { id: input.paymentId } }).catch(() => null)
    : await prisma.payment.findFirst({ where: { orderId }, orderBy: { createdAt: "desc" } }).catch(() => null)
  const paidViaWallet = String(payment?.gateway || "").toLowerCase() === "wallet"

  let refundedVia: "wallet" | "gateway" = paidViaWallet ? "wallet" : "gateway"
  let refundReferenceId: string | null = null

  await prisma.$transaction(async (tx) => {
    const current = await tx.snapshotCharge.findUnique({ where: { id: chargeId } })
    const meta = record(current?.metadata)
    if (paidViaWallet && payment && Number(payment?.amount) > 0) {
      refundReferenceId = `${payment.id}-snapshot-refund`
      const existingRefund = await tx.walletTransaction.findFirst({ where: { customerId, type: "refund", referenceId: refundReferenceId } })
      if (!existingRefund) {
        await createWalletTransaction(tx as any, {
          customerId,
          paymentId: payment.id,
          orderId,
          type: "refund",
          amount: Number(payment.amount),
          reason: `Snapshot "${snapshotName}" creation failed; payment refunded`,
          referenceId: refundReferenceId,
          createdByType: "system",
          status: "completed",
          currency: String(payment.currency || "INR"),
        })
      }
      await tx.snapshotCharge.update({
        where: { id: chargeId },
        data: {
          status: "refunded",
          metadata: {
            ...meta,
            lifecycle: "REFUNDED",
            failedAt: new Date().toISOString(),
            failure: { message, actor },
            refundedAt: new Date().toISOString(),
            refund: { via: "wallet", paymentId: payment.id, referenceId: refundReferenceId },
            operationId: meta.operationId || null,
          } as any,
        },
      })
    } else {
      if (!paidViaWallet) refundedVia = "gateway"
      await tx.snapshotCharge.update({
        where: { id: chargeId },
        data: {
          status: "refund_pending",
          metadata: {
            ...meta,
            lifecycle: "REFUND_PENDING",
            failedAt: new Date().toISOString(),
            failure: { message, actor },
            refundVia: refundedVia,
            operationId: meta.operationId || null,
          } as any,
        },
      })
    }
  })

  await createPanelLog({
    category: "Billing",
    level: "error",
    message: refundedVia === "wallet" ? "snapshot_charge_failed_refunded" : "snapshot_charge_failed_refund_pending",
    customerId,
    orderId,
    paymentId: payment?.id || null,
    metadata: { snapshotName, error: message, refundedVia, refundReferenceId, actor },
  }).catch(() => null)
  writeAuditLog({
    action: refundedVia === "wallet" ? "snapshot.payment.refunded" : "snapshot.payment.refund_pending",
    customerId,
    targetType: "snapshot_charge",
    targetId: chargeId,
    newValue: { orderId, snapshotName, error: message, refundReferenceId, paymentId: payment?.id || null, refundedVia, actor },
    metadata: { nodeId: null, actor, kind: "snapshot_failure_refund" },
  }).catch(() => null)

  console.log("[billing] snapshot charge refund path", { chargeId, orderId, paidViaWallet, refundedVia, refundReferenceId, message })
}

export async function settleBillableOrderAfterPayment(input: SettleInput) {
  const order = input.order
  if (!order?.id || !isBillableOrder(order)) return { settled: false, reason: "not_billable" }

  return withRedisLock(`billable-settle:${order.id}`, 20000, async () => {
    const kind = orderKind(order)
    try {
      if (kind === "backup_plan") return await settleBackupPlan(order, input)
      if (kind === "backup_plan_renewal") return await settleBackupPlanRenewal(order, input)
      if (kind === "backup_storage_upgrade") return await settleBackupStorageUpgrade(order, input)
      if (kind === "snapshot_charge") return await settleSnapshotCharge(order, input)
      return { settled: false, reason: "unknown_kind" }
    } catch (error: any) {
      await createPanelLog({
        category: "Billing",
        level: "error",
        message: "billable_order_settlement_failed",
        customerId: order.customerId,
        orderId: order.id,
        paymentId: input.paymentId || null,
        metadata: { kind, actor: input.actor || "system", error: error?.message || String(error) },
      }).catch(() => null)
      return { settled: false, reason: "settlement_failed", error: error?.message || String(error) }
    }
  })
}