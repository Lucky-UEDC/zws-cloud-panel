import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { finalizeSuccessfulPayment } from "@/lib/payment-finalization"
import { enqueuePaymentOutbox } from "@/lib/payments/outbox"

export async function requestManualPayment(input: { invoiceId: string; transactionReference: string; method: string; amount: number; currency: string; paidAt: Date; evidence: string; requestedBy: string }) {
  if (!input.transactionReference.trim()) throw Object.assign(new Error("A unique transaction reference is required."), { code: "manual_reference_required" })
  if (!input.method.trim()) throw Object.assign(new Error("Payment method is required."), { code: "manual_method_required" })
  if (!input.evidence.trim()) throw Object.assign(new Error("Evidence or an audit note is required."), { code: "manual_evidence_required" })
  const invoice = await prisma.invoice.findUnique({ where: { id: input.invoiceId } })
  if (!invoice || invoice.deletedAt) throw Object.assign(new Error("Invoice not found."), { code: "invoice_not_found" })
  if (String(invoice.status).toLowerCase() === "paid") throw Object.assign(new Error("Invoice is already paid."), { code: "invoice_already_paid" })
  if (Math.abs(Number(invoice.totalAmount) - input.amount) > 0.009 || String(invoice.currency).toUpperCase() !== input.currency.toUpperCase()) throw Object.assign(new Error("Manual payment amount or currency does not match the invoice."), { code: "manual_amount_mismatch" })
  return (prisma as any).manualPaymentRequest.create({ data: { ...input, transactionReference: input.transactionReference.trim(), method: input.method.trim(), currency: input.currency.toUpperCase(), evidence: input.evidence.trim(), status: "pending_approval" } })
}

export async function approveManualPayment(input: { requestId: string; approvedBy: string }) {
  const prepared = await prisma.$transaction(async (tx) => {
    const request = await (tx as any).manualPaymentRequest.findUnique({ where: { id: input.requestId } })
    if (!request) throw Object.assign(new Error("Manual payment request not found."), { code: "manual_request_not_found" })
    if (request.status === "approved" && request.paymentId) return { request, attemptId: null, reused: true }
    if (request.status !== "pending_approval") throw Object.assign(new Error(`Manual payment request is ${request.status}.`), { code: "manual_request_not_pending" })
    if (String(request.requestedBy).toLowerCase() === input.approvedBy.toLowerCase()) throw Object.assign(new Error("A second authorized administrator must approve this payment."), { code: "second_approver_required" })
    const invoice = await tx.invoice.findUnique({ where: { id: request.invoiceId } })
    if (!invoice || invoice.deletedAt) throw Object.assign(new Error("Invoice not found."), { code: "invoice_not_found" })
    if (String(invoice.status).toLowerCase() === "paid") throw Object.assign(new Error("Invoice is already paid."), { code: "invoice_already_paid" })
    const payment = await tx.payment.create({ data: { invoiceId: invoice.id, orderId: invoice.orderId, customerId: invoice.customerId, gateway: "manual", amount: request.amount, gatewayAmount: request.amount, currency: request.currency, status: "pending", paymentMethod: request.method, purpose: "manual_invoice_payment", idempotencyKey: `manual:${request.transactionReference}`, transactionId: request.transactionReference, gatewayTransactionId: request.transactionReference } })
    const attempt = await tx.paymentAttempt.create({ data: { invoiceId: invoice.id, orderId: invoice.orderId, paymentId: payment.id, userId: invoice.customerId, gateway: "manual", merchantOrderId: `manual:${request.transactionReference}`, gatewayTransactionId: request.transactionReference, amount: request.amount, currency: request.currency, status: "created", mode: "manual", rawGatewayResponse: { evidence: request.evidence, requestedBy: request.requestedBy, approvedBy: input.approvedBy } } })
    const approved = await (tx as any).manualPaymentRequest.update({ where: { id: request.id }, data: { status: "approved", approvedBy: input.approvedBy, approvedAt: new Date(), paymentId: payment.id } })
    await enqueuePaymentOutbox(tx, { eventType: "manual_payment_approved", aggregateType: "payment", aggregateId: payment.id, idempotencyKey: `manual-payment-approved:${request.id}`, payload: { paymentId: payment.id, invoiceId: invoice.id, orderId: invoice.orderId, requestId: request.id } })
    return { request: approved, attemptId: attempt.id, reused: false }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  if (prepared.reused || !prepared.attemptId) return prepared
  const finalized = await finalizeSuccessfulPayment(prepared.attemptId, { actor: `admin:${input.approvedBy}`, manualVerification: false, autoProvision: true, gatewayTransactionId: prepared.request.transactionReference, paymentMethod: prepared.request.method, amount: Number(prepared.request.amount), currency: prepared.request.currency })
  if (!finalized.finalized) throw Object.assign(new Error(String(finalized.reason || "Manual payment finalization failed.")), { code: "manual_finalization_failed" })
  return { ...prepared, finalized }
}
