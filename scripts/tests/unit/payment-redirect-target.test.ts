import assert from "node:assert/strict"
import test from "node:test"
import { resolvePaymentCheckoutTarget } from "@/lib/client/payment-redirect"

test("cashfree checkout target renders a payment-session when production mode is resolved", () => {
  const target = resolvePaymentCheckoutTarget({
    gateway: "cashfree",
    gatewayOrderId: "6893196701",
    paymentSessionId: "session_prod_123",
    mode: "production",
  })
  assert.deepEqual(target, { kind: "payment-session", paymentSessionId: "session_prod_123", mode: "production", fallbackUrl: null })
})

test("cashfree checkout target never accepts a session before the backend derives production mode", () => {
  const target = resolvePaymentCheckoutTarget({
    gateway: "cashfree",
    gatewayOrderId: "6893196701",
    paymentSessionId: "session_prod_123",
    mode: "direct",
  })
  assert.deepEqual(target?.kind, "payment-session")
  assert.equal(target?.kind === "payment-session" && target.mode, "sandbox")
})

test("razorpay checkout target requires an order_-prefixed order id", () => {
  const fresh = resolvePaymentCheckoutTarget({
    gateway: "razorpay",
    razorpayOrderId: "order_ND123",
    checkoutOptions: { order_id: "order_ND123", key: "rzp_live_test" },
  })
  assert.deepEqual(fresh, { kind: "razorpay-order", orderId: "order_ND123" })

  const crossGatewayReuse = resolvePaymentCheckoutTarget({
    gateway: "razorpay",
    gatewayOrderId: "6893196701",
    paymentSessionId: "session_prod_123",
    checkoutOptions: null,
  })
  assert.equal(crossGatewayReuse, null)
})

test("non-cashfree session still falls back to a plain url target", () => {
  const target = resolvePaymentCheckoutTarget({
    gateway: "phonepe",
    paymentUrl: "https://pay.example.com/checkout?q=1",
    mode: "production",
  })
  assert.deepEqual(target, { kind: "url", url: "https://pay.example.com/checkout?q=1" })
})