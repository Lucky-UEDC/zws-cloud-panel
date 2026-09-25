import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"

const DEFAULT_ACCOUNTS = [
  ["1000", "Bank", "asset"],
  ["1100", "Gateway clearing", "asset"],
  ["1200", "Accounts receivable", "asset"],
  ["2100", "GST payable", "liability"],
  ["2200", "Wallet liability", "liability"],
  ["4000", "Service revenue", "revenue"],
  ["4050", "Discounts", "contra_revenue"],
  ["5100", "Gateway fees", "expense"],
  ["5200", "Refunds", "contra_revenue"],
] as const

export async function ensureAccountingAccounts(tx: any = prisma) {
  for (const [code, name, type] of DEFAULT_ACCOUNTS) {
    await tx.accountingAccount.upsert({ where: { code }, update: { name, type, active: true }, create: { code, name, type } })
  }
}

export async function postBalancedJournal(input: {
  idempotencyKey: string
  eventType: string
  sourceType: string
  sourceId: string
  currency: string
  effectiveAt?: Date
  memo?: string
  metadata?: Record<string, unknown>
  entries: Array<{ accountCode: string; direction: "debit" | "credit"; amount: number; metadata?: Record<string, unknown> }>
}) {
  const debit = input.entries.filter((entry) => entry.direction === "debit").reduce((sum, entry) => sum + Number(entry.amount), 0)
  const credit = input.entries.filter((entry) => entry.direction === "credit").reduce((sum, entry) => sum + Number(entry.amount), 0)
  if (Math.abs(debit - credit) > 0.009 || debit <= 0) throw Object.assign(new Error(`Journal is unbalanced: debit=${debit.toFixed(2)} credit=${credit.toFixed(2)}`), { code: "unbalanced_journal" })
  return prisma.$transaction(async (tx) => {
    await ensureAccountingAccounts(tx)
    const existing = await (tx as any).accountingJournal.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { entries: true } })
    if (existing) return existing
    const accounts = await (tx as any).accountingAccount.findMany({ where: { code: { in: input.entries.map((entry) => entry.accountCode) } } }) as Array<{ id: string; code: string }>
    const accountByCode = new Map<string, { id: string; code: string }>(accounts.map((account) => [account.code, account]))
    const missingAccount = input.entries.find((entry) => !accountByCode.has(entry.accountCode))
    if (missingAccount) throw Object.assign(new Error(`Accounting account ${missingAccount.accountCode} is not configured.`), { code: "accounting_account_missing" })
    return (tx as any).accountingJournal.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        eventType: input.eventType,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        currency: input.currency,
        effectiveAt: input.effectiveAt || new Date(),
        memo: input.memo || null,
        metadata: input.metadata || {},
        entries: { create: input.entries.map((entry) => ({ accountId: accountByCode.get(entry.accountCode)!.id, direction: entry.direction, amount: new Prisma.Decimal(entry.amount), currency: input.currency, metadata: entry.metadata || {} })) },
      },
      include: { entries: true },
    })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export async function postPaymentRevenue(input: { paymentId: string; amount: number; taxAmount: number; discountAmount?: number; currency: string; effectiveAt?: Date }) {
  const netRevenue = Number((input.amount - input.taxAmount).toFixed(2))
  return postBalancedJournal({ idempotencyKey: `payment-captured:${input.paymentId}`, eventType: "payment_captured", sourceType: "payment", sourceId: input.paymentId, currency: input.currency, effectiveAt: input.effectiveAt, entries: [
    { accountCode: "1100", direction: "debit", amount: input.amount },
    { accountCode: "4000", direction: "credit", amount: netRevenue },
    ...(input.taxAmount > 0 ? [{ accountCode: "2100", direction: "credit" as const, amount: input.taxAmount }] : []),
  ] })
}

export async function journalBalanceReport() {
  const rows = await (prisma as any).$queryRaw(Prisma.sql`
    SELECT journal_id AS "journalId",
      COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END), 0)::float AS debit,
      COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END), 0)::float AS credit
    FROM accounting_entries GROUP BY journal_id
    HAVING ABS(SUM(CASE WHEN direction = 'debit' THEN amount ELSE -amount END)) > 0.009
  `) as Array<{ journalId: string; debit: number; credit: number }>
  return { balanced: rows.length === 0, unbalanced: rows }
}

export async function importGatewaySettlement(input: { gateway: string; reference: string; currency: string; grossAmount: number; feeAmount: number; taxAmount: number; netAmount: number; settledAt: Date; sourceHash: string; metadata?: Record<string, unknown> }) {
  const expectedNet = Number((input.grossAmount - input.feeAmount - input.taxAmount).toFixed(2))
  if (Math.abs(expectedNet - input.netAmount) > 0.009) throw Object.assign(new Error(`Settlement does not balance: expected net ${expectedNet.toFixed(2)}.`), { code: "settlement_amount_mismatch" })
  const settlement = await (prisma as any).gatewaySettlement.upsert({ where: { sourceHash: input.sourceHash }, update: {}, create: { gateway: input.gateway, settlementReference: input.reference, currency: input.currency, grossAmount: input.grossAmount, feeAmount: input.feeAmount, taxAmount: input.taxAmount, netAmount: input.netAmount, settledAt: input.settledAt, sourceHash: input.sourceHash, status: "reconciled", metadata: input.metadata || {} } })
  await postBalancedJournal({ idempotencyKey: `settlement:${input.gateway}:${input.reference}`, eventType: "gateway_settlement", sourceType: "settlement", sourceId: settlement.id, currency: input.currency, effectiveAt: input.settledAt, entries: [
    { accountCode: "1000", direction: "debit", amount: input.netAmount },
    ...(input.feeAmount > 0 ? [{ accountCode: "5100", direction: "debit" as const, amount: input.feeAmount }] : []),
    ...(input.taxAmount > 0 ? [{ accountCode: "5100", direction: "debit" as const, amount: input.taxAmount, metadata: { kind: "gateway_fee_tax" } }] : []),
    { accountCode: "1100", direction: "credit", amount: input.grossAmount },
  ] })
  return settlement
}
