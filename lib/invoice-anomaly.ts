export type InvoiceAnomalyRow = {
  id: string
  invoiceNumber: string
  customerId: string
  status: string
  type: string
  createdAt: Date
  orderId: string | null
  paymentTransactionId: string | null
  metadata: Record<string, unknown>
}

export type InvoiceAnomalyClassification = {
  innerClass: "abandoned_checkout_artifact" | "orphaned_untracked_service_invoice"
  checkoutReference: string
  artifactKeys: string[]
}

const ARTIFACT_KEY_RE = /checkout|intent|session|link|payment|expire|initiat/i

export function classifyOrderlessInvoice(invoice: InvoiceAnomalyRow): InvoiceAnomalyClassification {
  const meta = invoice.metadata || {}
  const checkoutReference = String(
    meta.checkoutReference || meta.checkoutSessionId || meta.sessionId || meta.gatewayIntentId || meta.intentId || "",
  )
  const hasCheckoutArtifacts = Boolean(
    checkoutReference ||
      meta.checkoutUrl ||
      meta.paymentLink ||
      meta.intentId ||
      meta.gatewayIntentId ||
      meta.initiatedAt ||
      meta.expiresAt ||
      meta.startedAt,
  )
  return {
    innerClass: hasCheckoutArtifacts ? "abandoned_checkout_artifact" : "orphaned_untracked_service_invoice",
    checkoutReference,
    artifactKeys: Object.keys(meta).filter((key) => ARTIFACT_KEY_RE.test(key)).slice(0, 24),
  }
}

export function backupExceptionDetailForInvoice(
  invoice: InvoiceAnomalyRow,
  classification: InvoiceAnomalyClassification,
): Record<string, unknown> {
  return {
    invoiceNumber: invoice.invoiceNumber,
    customerId: invoice.customerId,
    status: invoice.status,
    createdAt: invoice.createdAt,
    orderId: invoice.orderId || null,
    paymentTransactionId: invoice.paymentTransactionId || null,
    checkoutReference: classification.checkoutReference || null,
    artifactKeys: classification.artifactKeys,
    metadata: invoice.metadata,
  }
}