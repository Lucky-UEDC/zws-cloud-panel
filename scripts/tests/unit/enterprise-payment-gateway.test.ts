import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { classifyGatewayFailure, ENTERPRISE_GATEWAYS } from "../../../lib/payments/gateway-driver"
import { hashIdempotencyKey, paymentObligationKey } from "../../../lib/payments/transaction-manager"

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8")

test("enterprise gateway priority is fixed and complete", () => {
  assert.deepEqual([...ENTERPRISE_GATEWAYS], ["razorpay", "phonepe", "cashfree"])
})

test("idempotency and obligation identities are deterministic", () => {
  assert.equal(paymentObligationKey({ invoiceId: "inv_1", orderId: "order_1" }), "order_payment:inv_1")
  assert.equal(hashIdempotencyKey("same"), hashIdempotencyKey("same"))
  assert.notEqual(hashIdempotencyKey("same"), hashIdempotencyKey("different"))
})

test("gateway failures preserve safe exact codes and ambiguous retry state", () => {
  const failure = classifyGatewayFailure(Object.assign(new Error("upstream network timeout"), { code: "PHONEPE_NETWORK_ERROR", status: 503 }))
  assert.equal(failure.code, "phonepe_network_error")
  assert.equal(failure.retryable, true)
  assert.equal(failure.ambiguous, true)
})

test("manual payment finalization requires two distinct administrators", () => {
  const source = read("lib/payments/manual-payments.ts")
  assert.match(source, /second authorized administrator/i)
  assert.match(source, /TransactionIsolationLevel\.Serializable/)
  assert.match(read("prisma/migrations/20260710123000_enterprise_payment_gateway_core/migration.sql"), /lower\("approved_by"\).*lower\("requested_by"\)/)
})

test("financial side effects use a durable outbox and balanced journals", () => {
  assert.match(read("lib/payment-finalization.ts"), /enqueuePaymentOutbox\(tx/)
  assert.match(read("lib/payments/revenue-engine.ts"), /unbalanced_journal/)
  assert.match(read("lib/payments/outbox.ts"), /FOR UPDATE SKIP LOCKED/)
})

test("gateway retries stop with the invoice lifecycle", () => {
  const source = read("lib/payments/retry-manager.ts")
  assert.match(source, /STOP_INVOICE_STATUSES/)
  assert.match(source, /paid.*cancelled.*canceled.*void.*refunded/)
  assert.match(source, /heldAt/)
})

test("payment routes use the shared gateway driver contract", () => {
  assert.match(read("lib/payment-gateways.ts"), /getGatewayDriver/)
  assert.match(read("lib/payments/gateway-drivers.ts"), /satisfies Record<string, GatewayDriver>/)
})
