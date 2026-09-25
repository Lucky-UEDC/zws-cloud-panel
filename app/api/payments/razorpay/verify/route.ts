import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"
import { activePaymentGatewayCredentials } from "@/lib/payments/payment-gateway-admin"
import { fetchRazorpayOrder, fetchRazorpayPayment, verifyRazorpayPaymentSignature } from "@/lib/razorpay"
import { paymentRequestId } from "@/lib/payments/trace"
import { finalizeSuccessfulPayment } from "@/lib/payment-finalization"
import { paymentFlowError, paymentFlowLog } from "@/lib/payment-flow-log"
import { captureAuthorizedRazorpayPayment } from "@/lib/payments/razorpay-capture"

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Invalid Razorpay signature." }, { status: 400 })
}

export async function POST(request: NextRequest) {
  const requestId = paymentRequestId(request)
  const body = await request.json().catch(() => ({}))
  const paymentId = String(body.paymentId || "")
  const razorpayPaymentId = String(body.razorpay_payment_id || "")
  const razorpayOrderId = String(body.razorpay_order_id || "")
  const signature = String(body.razorpay_signature || "")
  if (!razorpayOrderId || !razorpayPaymentId || !signature) return unauthorized()

  const gateway = await (prisma as any).paymentGateway.findFirst({
    where: { OR: [{ code: "razorpay" }, { provider: "razorpay" }], enabled: true },
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
  }).catch(() => null)
  if (!gateway) return NextResponse.json({ ok: false, error: "Razorpay is not configured." }, { status: 503 })
  const credentials = activePaymentGatewayCredentials(gateway)
  const verified = verifyRazorpayPaymentSignature({
    orderId: razorpayOrderId,
    paymentId: razorpayPaymentId,
    signature,
    keySecret: String(credentials.keySecret || ""),
  })
  if (!verified) {
    await createPanelLog({
      category: "Payment",
      level: "warn",
      message: "razorpay_checkout_signature_failed",
      metadata: { requestId, paymentId: paymentId || null, razorpayPaymentId, razorpayOrderId },
    }).catch(() => null)
    return unauthorized()
  }
  paymentFlowLog("Signature verified", { gateway: "razorpay", requestId, paymentId: paymentId || null, razorpayPaymentId, razorpayOrderId, source: "checkout_callback" })

  const attempt = await prisma.paymentAttempt.findFirst({
    where: {
      gateway: "razorpay",
      OR: [
        paymentId ? { paymentId } : undefined,
        razorpayOrderId ? { gatewayOrderId: razorpayOrderId } : undefined,
        razorpayPaymentId ? { gatewayPaymentId: razorpayPaymentId } : undefined,
      ].filter(Boolean) as any,
    },
    orderBy: { createdAt: "desc" },
  })
  if (!attempt) {
    return NextResponse.json({
      ok: false,
      success: false,
      error: "Payment attempt not found.",
      requestId,
      razorpayPaymentId,
      razorpayOrderId: razorpayOrderId || null,
    }, { status: 404 })
  }

  let gatewayPayment = await fetchRazorpayPayment(gateway, razorpayPaymentId).catch((error) => ({
    id: razorpayPaymentId,
    order_id: razorpayOrderId,
    status: "verification_fetch_failed",
    error: error?.message || "Unable to fetch Razorpay payment after signature verification.",
  }))
  const gatewayOrder = await fetchRazorpayOrder(gateway, razorpayOrderId).catch(() => null)
  let paymentStatus = String((gatewayPayment as any)?.status || "").toLowerCase()
  if (paymentStatus === "authorized") {
    const capture = await captureAuthorizedRazorpayPayment({ attemptId: attempt.id, gatewayConfig: gateway, paymentId: razorpayPaymentId })
    if (capture.payment) gatewayPayment = capture.payment
    paymentStatus = String((gatewayPayment as any)?.status || "").toLowerCase()
    if (capture.state === "failed") {
      paymentFlowError("Razorpay capture failed", new Error(capture.reason), { requestId, paymentAttemptId: attempt.id, razorpayPaymentId, retryable: capture.retryable })
      return NextResponse.json({ ok: false, success: false, requestId, reason: capture.reason, retryable: capture.retryable, paymentAttemptId: attempt.id }, { status: capture.retryable ? 503 : 422 })
    }
    if (capture.state === "processing") {
      return NextResponse.json({ ok: true, success: true, requestId, finalized: false, reason: capture.reason, status: "capture_processing", paymentAttemptId: attempt.id }, { status: 202 })
    }
  }
  const orderStatus = String((gatewayOrder as any)?.status || "").toLowerCase()
  const captured = paymentStatus === "captured" || orderStatus === "paid"
  const gatewayAmount = Number((gatewayPayment as any)?.amount || (gatewayOrder as any)?.amount_paid || (gatewayOrder as any)?.amount || 0) / 100
  const gatewayCurrency = String((gatewayPayment as any)?.currency || (gatewayOrder as any)?.currency || attempt.currency || "INR").toUpperCase()

  await prisma.paymentAttempt.update({
    where: { id: attempt.id },
    data: {
      status: captured ? "success" : "authorized",
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      gatewayTransactionId: razorpayPaymentId,
      webhookVerifiedAt: new Date(),
      rawGatewayResponse: {
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: signature,
        verifiedBy: "checkout_callback",
        verifiedAt: new Date().toISOString(),
        payment: gatewayPayment,
        order: gatewayOrder,
      },
    },
  })
  if (attempt.paymentId) {
    await prisma.payment.update({
      where: { id: attempt.paymentId },
      data: {
        status: captured ? "completed" : "authorized",
        gatewayOrderId: razorpayOrderId,
        gatewayPaymentId: razorpayPaymentId,
        gatewayTransactionId: razorpayPaymentId,
        transactionId: razorpayPaymentId,
        gatewayResponse: {
          razorpay_order_id: razorpayOrderId,
          razorpay_payment_id: razorpayPaymentId,
          signatureVerified: true,
          verifiedBy: "checkout_callback",
          verifiedAt: new Date().toISOString(),
          payment: gatewayPayment,
          order: gatewayOrder,
        },
      },
    }).catch(() => null)
  }
  const finalized = captured
    ? await finalizeSuccessfulPayment(attempt.id, {
      actor: "razorpay_checkout_callback",
      amount: Number.isFinite(gatewayAmount) && gatewayAmount > 0 ? gatewayAmount : Number(attempt.amount),
      currency: gatewayCurrency,
      gatewayOrderId: razorpayOrderId,
      gatewayPaymentId: razorpayPaymentId,
      gatewayTransactionId: razorpayPaymentId,
      paymentMethod: (gatewayPayment as any)?.method || null,
      gatewayResponse: {
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        signatureVerified: true,
        verifiedBy: "checkout_callback",
        payment: gatewayPayment,
        order: gatewayOrder,
      },
    }).catch((error) => {
      paymentFlowError("Payment finalization threw", error, { gateway: "razorpay", requestId, paymentAttemptId: attempt.id, paymentId: attempt.paymentId || null, invoiceId: attempt.invoiceId || null, orderId: attempt.orderId || null, source: "checkout_callback" })
      return {
        finalized: false,
        reason: "checkout_callback_finalization_failed",
        error: error?.message || "Finalization failed after Razorpay signature verification.",
      }
    })
    : { finalized: false, reason: "waiting_for_payment_captured_webhook" }
  if (captured && !(finalized as any).finalized) {
    paymentFlowLog("Payment finalization failed", { gateway: "razorpay", requestId, paymentAttemptId: attempt.id, paymentId: attempt.paymentId || null, invoiceId: (finalized as any).invoiceId || attempt.invoiceId || null, orderId: (finalized as any).orderId || attempt.orderId || null, reason: (finalized as any).reason || null, source: "checkout_callback" })
    return NextResponse.json({
      ok: false,
      success: false,
      requestId,
      finalized: false,
      reason: (finalized as any).reason || "payment_finalization_failed",
      paymentId: attempt.paymentId || paymentId || null,
      paymentAttemptId: attempt.id,
      gatewayOrderId: razorpayOrderId || null,
      gatewayPaymentId: razorpayPaymentId,
      finalization: finalized,
    }, { status: 500 })
  }
  return NextResponse.json({
    ok: true,
    success: true,
    requestId,
    finalized: Boolean((finalized as any)?.finalized),
    reason: (finalized as any)?.reason || (captured ? "finalized_from_checkout_callback" : "waiting_for_payment_captured_webhook"),
    paymentId: attempt.paymentId || paymentId || null,
    paymentAttemptId: attempt.id,
    gatewayOrderId: razorpayOrderId || null,
    gatewayPaymentId: razorpayPaymentId,
    razorpayFlow: "order",
    status: captured ? "captured" : "authorized",
    finalization: finalized,
  })
}
