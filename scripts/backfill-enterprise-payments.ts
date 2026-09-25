import "dotenv/config"
import { prisma } from "@/lib/db"
import { postPaymentRevenue } from "@/lib/payments/revenue-engine"

const apply = process.argv.includes("--apply")

function obligation(row: any) {
  const identity = row.invoiceId || row.orderId || row.paymentId
  return identity ? `order_payment:${identity}` : null
}

async function main() {
  const transactions = await (prisma as any).paymentTransaction.findMany({ where: { obligationKey: null }, orderBy: { createdAt: "asc" } })
  const grouped = new Map<string, any[]>()
  const unmapped: string[] = []
  for (const row of transactions) {
    const key = obligation(row)
    if (!key) { unmapped.push(row.id); continue }
    grouped.set(key, [...(grouped.get(key) || []), row])
  }
  const ambiguous = [...grouped.entries()].filter(([, rows]) => rows.length > 1).map(([key, rows]) => ({ obligationKey: key, transactionIds: rows.map((row) => row.id) }))
  const deterministic = [...grouped.entries()].filter(([, rows]) => rows.length === 1).map(([key, rows]) => ({ key, row: rows[0] }))
  let transactionBackfills = 0
  let journalBackfills = 0
  if (apply) {
    for (const item of deterministic) {
      await (prisma as any).paymentTransaction.update({ where: { id: item.row.id }, data: { obligationKey: item.key, authorizationState: ["success", "completed", "paid", "captured"].includes(String(item.row.status).toLowerCase()) ? "captured" : "none" } })
      transactionBackfills += 1
    }
    const payments = await prisma.payment.findMany({ where: { status: { in: ["completed", "paid", "success", "captured"] }, invoiceId: { not: null } }, include: { invoice: true } })
    for (const payment of payments) {
      if (!payment.invoice) continue
      await postPaymentRevenue({ paymentId: payment.id, amount: Number(payment.amount), taxAmount: Number(payment.invoice.taxAmount || 0), currency: payment.currency, effectiveAt: payment.completedAt || payment.createdAt })
      journalBackfills += 1
    }
  }
  const activeAmbiguous = ambiguous.filter((item) => item.transactionIds.some((id) => transactions.find((row: any) => row.id === id && !["failed", "cancelled", "expired", "refunded"].includes(String(row.status).toLowerCase()))))
  const report = { mode: apply ? "apply" : "dry-run", scannedTransactions: transactions.length, deterministic: deterministic.length, ambiguous: ambiguous.length, unmapped: unmapped.length, activeAmbiguous: activeAmbiguous.length, transactionBackfills, journalBackfills, ambiguousItems: ambiguous.slice(0, 100), unmappedTransactionIds: unmapped.slice(0, 100) }
  console.log(JSON.stringify(report, null, 2))
  if (activeAmbiguous.length > 0) process.exitCode = 2
}

main().catch((error) => { console.error(JSON.stringify({ ok: false, code: "enterprise_payment_backfill_failed", error: error instanceof Error ? error.message : String(error) })); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect().catch(() => undefined) })
