import { prisma } from "@/lib/db"
import { captureRazorpayPayment, fetchRazorpayPayment } from "@/lib/razorpay"

const MAX_CAPTURE_ATTEMPTS = 3
const CAPTURE_CLAIM_TTL_MS = 2 * 60_000

type CaptureResult = {
  state: "captured" | "processing" | "failed"
  payment: any | null
  retryable: boolean
  reason: string
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Razorpay capture failed")
  return message.replace(/rzp_(?:live|test)_[A-Za-z0-9]+/g, "[redacted]").slice(0, 500)
}

async function markCaptured(attemptId: string, payment: any) {
  const now = new Date()
  await prisma.paymentAttempt.update({
    where: { id: attemptId },
    data: {
      captureStatus: "captured",
      capturedAt: now,
      captureClaimedAt: null,
      captureLastError: null,
      status: "captured",
      gatewayPaymentId: payment?.id || undefined,
      gatewayTransactionId: payment?.id || undefined,
      statusCheckedAt: now,
    },
  })
}

export async function captureAuthorizedRazorpayPayment(input: {
  attemptId: string
  gatewayConfig: any
  paymentId: string
}): Promise<CaptureResult> {
  const attempt = await prisma.paymentAttempt.findUnique({ where: { id: input.attemptId } })
  if (!attempt) return { state: "failed", payment: null, retryable: false, reason: "payment_attempt_not_found" }

  const current = await fetchRazorpayPayment(input.gatewayConfig, input.paymentId).catch(() => null)
  if (String(current?.status || "").toLowerCase() === "captured") {
    await markCaptured(attempt.id, current)
    return { state: "captured", payment: current, retryable: false, reason: "already_captured" }
  }
  if (String(current?.status || "").toLowerCase() !== "authorized") {
    return { state: "failed", payment: current, retryable: false, reason: `payment_not_authorized:${String(current?.status || "unknown")}` }
  }

  const staleClaim = new Date(Date.now() - CAPTURE_CLAIM_TTL_MS)
  const claim = await prisma.paymentAttempt.updateMany({
    where: {
      id: attempt.id,
      captureAttempts: { lt: MAX_CAPTURE_ATTEMPTS },
      OR: [
        { captureStatus: { in: ["not_required", "authorized", "retryable_failed"] } },
        { captureStatus: "processing", captureClaimedAt: { lt: staleClaim } },
      ],
    },
    data: {
      captureStatus: "processing",
      captureClaimedAt: new Date(),
      captureAttempts: { increment: 1 },
      captureLastError: null,
      gatewayPaymentId: input.paymentId,
      gatewayTransactionId: input.paymentId,
      status: "authorized",
    },
  })
  if (claim.count !== 1) {
    const observed = await prisma.paymentAttempt.findUnique({ where: { id: attempt.id }, select: { captureStatus: true, captureAttempts: true } })
    return {
      state: observed?.captureStatus === "captured" ? "captured" : observed?.captureAttempts === MAX_CAPTURE_ATTEMPTS ? "failed" : "processing",
      payment: current,
      retryable: observed?.captureAttempts !== MAX_CAPTURE_ATTEMPTS,
      reason: observed?.captureStatus === "captured" ? "captured_by_concurrent_worker" : "capture_owned_by_concurrent_worker",
    }
  }

  try {
    const captured = await captureRazorpayPayment(input.gatewayConfig, input.paymentId, Number(attempt.amount), attempt.currency)
    await markCaptured(attempt.id, captured)
    return { state: "captured", payment: captured, retryable: false, reason: "captured" }
  } catch (error) {
    const reconciled = await fetchRazorpayPayment(input.gatewayConfig, input.paymentId).catch(() => null)
    if (String(reconciled?.status || "").toLowerCase() === "captured") {
      await markCaptured(attempt.id, reconciled)
      return { state: "captured", payment: reconciled, retryable: false, reason: "captured_after_ambiguous_response" }
    }
    const refreshed = await prisma.paymentAttempt.findUnique({ where: { id: attempt.id }, select: { captureAttempts: true } })
    const exhausted = Number(refreshed?.captureAttempts || 0) >= MAX_CAPTURE_ATTEMPTS
    await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        captureStatus: exhausted ? "failed" : "retryable_failed",
        captureClaimedAt: null,
        captureLastError: safeError(error),
        statusCheckedAt: new Date(),
      },
    })
    return { state: "failed", payment: reconciled, retryable: !exhausted, reason: exhausted ? "capture_attempts_exhausted" : "capture_failed" }
  }
}
