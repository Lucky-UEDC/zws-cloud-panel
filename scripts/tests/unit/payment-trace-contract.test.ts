import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const root = process.cwd()

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8")
}

test("payment create route includes requestId in payment init payload contract", () => {
  const source = read("app/api/payments/create/route.ts")
  assert.match(source, /requestId:\s*referenceId/)
  assert.match(source, /recordGatewayAttempt/)
  assert.match(source, /status:\s*"started"/)
})
test("invoice pay route uses typed payment success/error response helpers", () => {
  const source = read("app/api/client/invoices/[id]/pay/route.ts")
  assert.match(source, /paymentErrorResponse\(/)
  assert.match(source, /paymentSuccessResponse\(/)
  assert.match(source, /requestId\s*=\s*paymentRequestId/)
})

test("invoice retry payments preserve pending order checkout context", () => {
  const source = read("app/api/client/invoices/[id]/pay/route.ts")
  assert.match(source, /recoverInvoiceOrderCheckoutSession/)
  assert.match(source, /invoiceMetadata\.pendingOrderSnapshot/)
  assert.match(source, /recoveredOrderCheckoutSession \? "order_payment" : "invoice_payment"/)
  assert.match(source, /recoveredOrderSession: Boolean\(recoveredOrderCheckoutSession\?\.id\)/)
})

test("payment finalizer recovers original checkout session and cannot report false success", () => {
  const source = read("lib/payment-finalization.ts")
  assert.match(source, /findRecoverableOrderCheckoutSession/)
  assert.match(source, /checkout_session_fulfillment_failed/)
  assert.match(source, /Recovered original order checkout session/)
  assert.match(source, /order_not_linked_after_payment/)
  assert.match(source, /return \{ finalized: false, reason: fulfilled\.reason/)
})

test("razorpay paid webhook fails when finalization does not provision or link an order", () => {
  const source = read("app/api/payments/webhook/route.ts")
  assert.match(source, /finalization_failed/)
  assert.match(source, /if \(!result\.finalized\)/)
  assert.match(source, /payment_finalization_failed/)
  assert.match(source, /\{ status: 500 \}/)
})

test("payment flow logs cover payment to provisioning milestones", () => {
  const finalizer = read("lib/payment-finalization.ts")
  const provision = read("lib/provision.ts")
  const verify = read("app/api/payments/razorpay/verify/route.ts")
  assert.match(read("lib/payment-flow-log.ts"), /\[PAYMENT\]/)
  assert.match(verify, /Signature verified/)
  assert.match(finalizer, /Invoice updated/)
  assert.match(finalizer, /Order found/)
  assert.match(finalizer, /Order updated/)
  assert.match(finalizer, /Provision job queued/)
  assert.match(provision, /Worker received job/)
  assert.match(provision, /VM created/)
  assert.match(provision, /Credentials generated/)
})

test("checkout/payment wrappers forward request id header", () => {
  const startRoute = read("app/api/payments/start/route.ts")
  const sessionRoute = read("app/api/checkout/sessions/route.ts")
  assert.match(startRoute, /headers\.set\("x-request-id"/)
  assert.match(sessionRoute, /headers\.set\("x-request-id"/)
})

test("canonical checkout session payment emits complete traced stages", () => {
  const source = read("app/api/payments/create/route.ts")
  const helper = read("lib/payments/checkout-idempotency.ts")
  for (const stage of ["checkout_session_creation", "checkout_session_lookup", "invoice_creation", "payment_creation", "gateway_order_creation", "transaction_commit", "response"]) {
    assert.match(source, new RegExp(`(?:start|pass|info)\\(\\"${stage}\\"`))
  }
  assert.match(source, /requestId:\s*input\.requestId/)
  assert.match(helper, /Checkout session transaction started/)
  assert.match(helper, /Checkout session transaction committed/)
  assert.match(helper, /Checkout payment preparation transaction committed/)
  assert.match(helper, /Gateway order creation completed/)
  assert.match(helper, /Checkout payment persistence transaction committed/)
})

test("frontend payment surfaces map backend error codes", () => {
  const helper = read("lib/client/payment-errors.ts")
  assert.match(helper, /paymentClientMessage/)
  assert.match(helper, /no_gateway_available/)
  assert.match(helper, /payment_init_failed/)
})

test("toolchain preflight script exists and validates tsx loader", () => {
  const source = read("scripts/preflight-toolchain.mjs")
  assert.match(source, /tsx/)
  assert.match(source, /loader\.mjs/)
  assert.match(source, /Toolchain check failed/)
})
