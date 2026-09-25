import "dotenv/config"
import { prisma } from "@/lib/db"
import { getBillingPricingSettings } from "@/lib/settings"
import { createPanelLog } from "@/lib/panel-log"
import { deleteInvoiceSafely, DELETABLE_INVOICE_STATUSES } from "@/lib/invoice-deletion"

async function main() {
  const settings = await getBillingPricingSettings()
  const cleanup = settings.invoiceCleanup || {}
  const enabled = Boolean(cleanup.enabled)
  const deleteAfterDays = Number(cleanup.deleteAfterDays || 7)
  const statuses = Array.isArray(cleanup.statuses) && cleanup.statuses.length
    ? cleanup.statuses.filter((status) => (DELETABLE_INVOICE_STATUSES as readonly string[]).includes(status))
    : [...DELETABLE_INVOICE_STATUSES]

  if (!enabled) {
    const result = { deleted: 0, skipped: 0, disabled: true }
    console.log("[invoice-cleanup]", result)
    await createPanelLog({
      category: "Admin Action",
      message: "invoice_cleanup_skipped_disabled",
      actorType: "system",
      metadata: result,
    }).catch(() => null)
    return
  }

  const olderThan = new Date(Date.now() - deleteAfterDays * 24 * 60 * 60 * 1000)
  const invoices = await prisma.invoice.findMany({
    where: {
      createdAt: { lt: olderThan },
      status: { in: statuses },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  })

  let deleted = 0
  let skippedPaid = 0
  let skippedSuccessfulPayment = 0
  let skippedActive = 0
  let skippedUnsafe = 0

  for (const invoice of invoices) {
    const result = await deleteInvoiceSafely(invoice.id)
    if (result.deleted) {
      deleted += 1
    } else if (result.safety.paidInvoice) {
      skippedPaid += 1
    } else if (result.safety.reason === "successful_payment") {
      skippedSuccessfulPayment += 1
    } else if (["active_order", "active_service"].includes(String(result.safety.reason))) {
      skippedActive += 1
    } else {
      skippedUnsafe += 1
    }
  }

  const summary = {
    scanned: invoices.length,
    deleted,
    skipped: invoices.length - deleted,
    skippedPaid,
    skippedSuccessfulPayment,
    skippedActive,
    skippedUnsafe,
    deleteAfterDays,
    statuses,
    olderThan: olderThan.toISOString(),
  }
  console.log("[invoice-cleanup]", summary)
  await createPanelLog({
    category: "Admin Action",
    message: "invoice_cleanup_completed",
    actorType: "system",
    metadata: summary,
  }).catch(() => null)
}

main()
  .catch((error) => {
    console.error("[invoice-cleanup] failed", { message: error?.message || String(error) })
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
