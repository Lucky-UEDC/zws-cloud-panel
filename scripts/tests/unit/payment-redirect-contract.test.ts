import assert from "node:assert/strict"
import test from "node:test"
import {
  resolvePaymentCheckoutTarget,
  startPaymentRedirect,
  type PaymentRedirectResponse,
} from "../../../lib/client/payment-redirect"

function canonicalRazorpayResponse(overrides: Partial<PaymentRedirectResponse> = {}): PaymentRedirectResponse {
  return {
    gateway: "razorpay",
    publicKey: "rzp_test_public",
    order_id: "order_checkout_123",
    gatewayOrderId: "order_checkout_123",
    paymentSessionId: null,
    paymentUrl: null,
    redirectUrl: null,
    statusUrl: "/payment/status?order_id=CHK-123",
    checkoutOptions: {
      order_id: "order_checkout_123",
      amount: 12345,
      currency: "INR",
      name: "MYRDPHUB",
      description: "Cloud instance",
      prefill: {
        name: "Test Customer",
        email: "customer@example.com",
        contact: "9999999999",
      },
      notes: { merchantOrderId: "CHK-123" },
    },
    ...overrides,
  }
}

test("standard Razorpay order is a checkout target without a URL or session ID", () => {
  assert.deepEqual(resolvePaymentCheckoutTarget(canonicalRazorpayResponse()), {
    kind: "razorpay-order",
    orderId: "order_checkout_123",
  })
})

test("Razorpay order resolution supports nested checkout options", () => {
  const response = canonicalRazorpayResponse({
    order_id: null,
    gatewayOrderId: null,
    razorpayOrderId: null,
    razorpay_order_id: null,
  })
  assert.deepEqual(resolvePaymentCheckoutTarget(response), {
    kind: "razorpay-order",
    orderId: "order_checkout_123",
  })
})

test("missing or invalid Razorpay order-only responses are rejected", () => {
  assert.equal(resolvePaymentCheckoutTarget(canonicalRazorpayResponse({
    order_id: null,
    gatewayOrderId: null,
    checkoutOptions: {},
  })), null)
  assert.equal(resolvePaymentCheckoutTarget(canonicalRazorpayResponse({
    order_id: "pay_not_an_order",
    gatewayOrderId: null,
    checkoutOptions: {},
    paymentSessionId: "must_not_fallback_to_cashfree",
    redirectUrl: "https://must-not-fallback.example.test",
  })), null)
})

test("non-Razorpay gateways retain session and URL targets", () => {
  assert.deepEqual(resolvePaymentCheckoutTarget({
    gateway: "cashfree",
    paymentSessionId: "session_123",
    paymentUrl: "https://payments.example.test/checkout",
    mode: "production",
  }), {
    kind: "payment-session",
    paymentSessionId: "session_123",
    mode: "production",
    fallbackUrl: "https://payments.example.test/checkout",
  })
  assert.deepEqual(resolvePaymentCheckoutTarget({
    gateway: "phonepe",
    redirectUrl: "https://payments.example.test/redirect",
  }), {
    kind: "url",
    url: "https://payments.example.test/redirect",
  })
})

test("Razorpay launcher opens checkout and verifies the callback", async () => {
  const originalWindow = (globalThis as any).window
  const originalDocument = (globalThis as any).document
  const originalFetch = globalThis.fetch
  let checkoutOptions: Record<string, any> | null = null
  let opened = 0
  let verificationRequest: { url: string; body: Record<string, any> } | null = null

  function RazorpayMock(this: { open?: () => void }, options: Record<string, any>) {
    checkoutOptions = options
    this.open = () => {
      opened += 1
      void options.handler({
        razorpay_payment_id: "pay_checkout_123",
        razorpay_order_id: "order_checkout_123",
        razorpay_signature: "signature_123",
      })
    }
  }

  ;(globalThis as any).window = {
    Razorpay: RazorpayMock,
    location: { href: "" },
  }
  ;(globalThis as any).document = {
    querySelector: () => ({ dataset: { razorpaySdk: "true" } }),
  }
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    verificationRequest = {
      url: String(input),
      body: JSON.parse(String(init?.body || "{}")),
    }
    return { ok: true } as Response
  }) as typeof fetch

  try {
    await startPaymentRedirect({ ...canonicalRazorpayResponse(), paymentId: "local_payment_123" } as PaymentRedirectResponse & { paymentId: string })
    assert.equal(opened, 1)
    assert.equal((checkoutOptions as Record<string, any> | null)?.order_id, "order_checkout_123")
    assert.equal((checkoutOptions as Record<string, any> | null)?.key, "rzp_test_public")
    assert.deepEqual(verificationRequest, {
      url: "/api/payments/razorpay/verify",
      body: {
        paymentId: "local_payment_123",
        razorpay_payment_id: "pay_checkout_123",
        razorpay_order_id: "order_checkout_123",
        razorpay_signature: "signature_123",
      },
    })
    assert.equal((globalThis as any).window.location.href, "/payment/status?order_id=CHK-123")
  } finally {
    globalThis.fetch = originalFetch
    if (originalWindow === undefined) delete (globalThis as any).window
    else (globalThis as any).window = originalWindow
    if (originalDocument === undefined) delete (globalThis as any).document
    else (globalThis as any).document = originalDocument
  }
})
