import { Prisma, type PrismaClient } from "@prisma/client"

type DbClient = PrismaClient | Prisma.TransactionClient

export type WalletTransactionType =
  | "admin_add"
  | "admin_deduct"
  | "topup"
  | "CREDIT_TOPUP"
  | "payment"
  | "refund"
  | "usage"

export type WalletAdjustmentInput = {
  customerId: string
  type: WalletTransactionType
  amount: number
  status?: string
  reason?: string
  note?: string
  referenceId?: string
  createdByType: "admin" | "client" | "system"
  createdByAdminId?: string
  paymentId?: string
  paymentAttemptId?: string
  orderId?: string
  currency?: string
  gateway?: string
  gatewayFee?: number
}

function decimal(value: number) {
  return new Prisma.Decimal(value.toFixed(2))
}

export async function createWalletTransaction(
  tx: DbClient,
  input: WalletAdjustmentInput,
) {
  if (input.amount <= 0) {
    throw new Error("Amount must be greater than zero")
  }

  const customer = await tx.customer.findUnique({
    where: { id: input.customerId },
    select: { id: true, walletBalance: true },
  })

  if (!customer) {
    throw new Error("Customer not found")
  }

  const before = Number(customer.walletBalance)
  const signed = input.type === "admin_deduct" || input.type === "payment" || input.type === "usage"
    ? -Math.abs(input.amount)
    : Math.abs(input.amount)
  const after = Number((before + signed).toFixed(2))

  if (after < 0) {
    throw new Error("Insufficient wallet balance")
  }

  await tx.customer.update({
    where: { id: input.customerId },
    data: { walletBalance: decimal(after) },
  })

  return tx.walletTransaction.create({
    data: {
      customerId: input.customerId,
      paymentId: input.paymentId,
      paymentAttemptId: input.paymentAttemptId,
      type: input.type,
      amount: decimal(Math.abs(input.amount)),
      balanceBefore: decimal(before),
      balanceAfter: decimal(after),
      status: input.status || "completed",
      reason: input.reason,
      note: input.note,
      referenceId: input.referenceId,
      createdByType: input.createdByType,
      createdByAdminId: input.createdByAdminId,
      orderId: input.orderId,
      currency: input.currency || "INR",
      gateway: input.gateway,
      gatewayFee: input.gatewayFee != null ? decimal(input.gatewayFee) : undefined,
    },
  })
}

export async function applyWalletToAmount(
  tx: DbClient,
  customerId: string,
  totalAmount: number,
  referenceId: string,
) {
  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    select: { walletBalance: true },
  })

  if (!customer) throw new Error("Customer not found")

  const balance = Number(customer.walletBalance)
  const walletApplied = Math.min(balance, totalAmount)
  const remaining = Number((totalAmount - walletApplied).toFixed(2))

  if (walletApplied > 0) {
    await createWalletTransaction(tx, {
      customerId,
      type: "payment",
      amount: walletApplied,
      reason: "Applied to payment",
      referenceId,
      createdByType: "system",
    })
  }

  return { walletApplied, remaining }
}
