import { prisma } from "@/lib/db"
import {
  backupExceptionDetailForInvoice,
  classifyOrderlessInvoice,
  type InvoiceAnomalyRow,
} from "@/lib/invoice-anomaly"

const REPAIR_TABLE = "production_data_repair_exceptions"

const listOrderlessServiceInvoices = async (): Promise<Array<InvoiceAnomalyRow & { customerEmail: string | null; totalAmount: unknown; currency: string }>> => {
  const db = (prisma as any).$queryRawUnsafe
  const invoices: any[] = await db.call(prisma, `
    SELECT i.id, i."invoiceNumber", i."customerId", i.status, i.type, i."totalAmount", i.currency,
           i."createdAt", i."orderId", i."paymentTransactionId", i.metadata,
           c.email AS "customerEmail",
           o."orderNumber" AS "orderNumber"
    FROM invoices i
    LEFT JOIN orders o ON o.id = i."orderId"
    JOIN customers c ON c.id = i."customerId"
    WHERE i.type = 'service'
      AND i."deletedAt" IS NULL
      AND i."orderId" IS NULL
      AND o.id IS NULL
    ORDER BY i."createdAt" ASC
  `)
  return (invoices || []).map((row: any) => ({
    ...row,
    metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata || "{}") : row.metadata || {},
  }))
}

const insertRepairException = async (invoice: InvoiceAnomalyRow & { customerEmail: string | null }) => {
  const classification = classifyOrderlessInvoice(invoice)
  const fingerprint = `abandoned_checkout_invoice:invoice:${invoice.id}`
  const evidence = backupExceptionDetailForInvoice(invoice, classification)
  const detectedAt = new Date()

  const exec = (prisma as any).$executeRawUnsafe
  const inserted = await exec.call(
    prisma,
    `
    INSERT INTO "${REPAIR_TABLE}"
      (id, fingerprint, category, status, blocking, entity_type, entity_id, evidence, recommended_action, detected_at, last_seen_at, resolution, created_at, updated_at)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $10, '{}'::jsonb, $10, $10)
    ON CONFLICT (fingerprint) DO NOTHING
  `,
    `repair_${invoice.id}`,
    fingerprint,
    "production_data_anomaly",
    "OPEN",
    false,
    "invoice",
    invoice.id,
    JSON.stringify(evidence),
    "retain_no_action_documented",
    detectedAt,
  )
  return { classification, inserted, fingerprint }
}

const main = async () => {
  const dryRun = process.argv.includes("--dry-run")
  const invoices = await listOrderlessServiceInvoices()
  console.log(`orderless service invoices found: ${invoices.length}`)
  const processed: string[] = []
  const skipped: string[] = []
  for (const invoice of invoices) {
    const classification = classifyOrderlessInvoice(invoice)
    console.log([
      `INV ${invoice.invoiceNumber}`,
      `id=${invoice.id}`,
      `customer=${invoice.customerEmail || invoice.customerId}`,
      `status=${invoice.status}`,
      `orderId=${invoice.orderId || "null"}`,
      `total=${invoice.totalAmount} ${invoice.currency}`,
      `class=${classification.innerClass}`,
      `checkoutRef=${classification.checkoutReference || "-"}`,
      `artifacts=${classification.artifactKeys.join(",") || "-"}`,
      `created=${invoice.createdAt.toISOString().slice(0, 10)}`,
    ].join(" | "))
    if (dryRun) {
      processed.push(invoice.invoiceNumber)
      continue
    }
    const { inserted, fingerprint } = await insertRepairException(invoice)
    if (inserted > 0) {
      processed.push(invoice.invoiceNumber)
      console.log(`   -> marked repair exception (fingerprint ${fingerprint}); retained, no deletion`)
    } else {
      skipped.push(invoice.invoiceNumber)
      console.log(`   -> already marked; skipped`)
    }
  }
  console.log(new Array(60).join("-"))
  console.log(`dry-run=${dryRun ? "yes" : "no"} marked=${processed.length} alreadyPresent=${skipped.length}`)
  await prisma.$disconnect()
}

main().catch(async (error) => {
  console.error((error as Error).message)
  await prisma.$disconnect().catch(() => null)
  process.exit(1)
})