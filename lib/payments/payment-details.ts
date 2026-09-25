function firstString(...values: unknown[]) {
  for (const value of values) {
    const text = typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim()
    if (text) return text
  }
  return null
}

function latest<T extends { createdAt?: Date | string | null }>(rows: T[] | undefined | null) {
  const list = Array.isArray(rows) ? rows.slice() : []
  return list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0] || null
}

export function serializePaymentDetails(input: {
  invoice?: any
  payment?: any
  paymentAttempt?: any
  order?: any
}) {
  const invoice = input.invoice
  const payment = input.payment || latest(invoice?.payments) || latest(input.order?.payments)
  const attempt = input.paymentAttempt || latest(invoice?.paymentAttempts) || latest(input.order?.paymentAttempts) || latest(payment?.paymentAttempts)
  const transactionId = firstString(
    attempt?.gatewayTransactionId,
    payment?.gatewayTransactionId,
    payment?.transactionId,
    invoice?.paymentTransactionId,
    attempt?.gatewayPaymentId,
    payment?.gatewayPaymentId,
    attempt?.merchantOrderId,
    payment?.gatewayOrderId,
  )
  return {
    gateway: firstString(attempt?.gateway, payment?.gateway) || null,
    status: firstString(payment?.status, attempt?.status, invoice?.status) || null,
    transactionId,
    transactionLabel: transactionId || "Pending gateway confirmation",
    gatewayOrderId: firstString(attempt?.gatewayOrderId, payment?.gatewayOrderId, input.order?.cashfreeOrderId),
    gatewayPaymentId: firstString(attempt?.gatewayPaymentId, payment?.gatewayPaymentId),
    merchantOrderId: firstString(attempt?.merchantOrderId, input.order?.orderNumber),
    utr: firstString(attempt?.utr, attempt?.bankReferenceId),
    bankReferenceId: firstString(attempt?.bankReferenceId),
    paidAt: payment?.completedAt || invoice?.paidAt || null,
    paymentMethod: firstString(payment?.paymentMethod),
    amountPaid: payment?.amount ?? invoice?.totalAmount ?? null,
  }
}

export function maskSensitiveGatewayPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSensitiveGatewayPayload)
  if (!value || typeof value !== "object") return value
  const masked: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/secret|password|authorization|token|salt|key|upi|card/i.test(key)) {
      masked[key] = entry ? "[masked]" : entry
    } else {
      masked[key] = maskSensitiveGatewayPayload(entry)
    }
  }
  return masked
}
