import assert from "node:assert/strict"
import test from "node:test"
import { round2, mulAmount, add, sub, gbFromBytes, bytesFromGb, money } from "@/lib/billing/money"
import { computePlanQuote } from "@/lib/billing/billable-orders"
import { creditFeeSettingsForGateway, computeGatewayFee } from "@/lib/billing/gateway-fee"
import { resolveOverStorage } from "@/lib/billing/entitlements"
import { isBillableOrder, orderKind } from "@/lib/billing/kinds"

test("money arithmetic keeps two-decimal rupees", () => {
  assert.equal(round2(add(1.01, 0.02)), 1.03)
  assert.equal(round2(mulAmount(199, 3)), 597)
  assert.equal(round2(sub(100, 3)), 97)
  assert.equal(money("10.5"), 10.5)
  assert.equal(money(0), 0)
})

test("GB and bytes helpers round-trip", () => {
  assert.equal(gbFromBytes(bytesFromGb(100)), 100)
  assert.equal(gbFromBytes(100n * 1024n ** 3n), 100)
  assert.equal(gbFromBytes(2n * 1024n ** 3n + 512n * 1024n ** 2n), 2.5)
})

test("computePlanQuote adds GST on the final grand total", async () => {
  const quote = await computePlanQuote({ monthlyPrice: 199, termMonths: 1, taxPercent: 18, countryCode: null })
  assert.equal(quote.subtotal, 199)
  assert.equal(quote.gst, 35.82)
  assert.equal(quote.total, 234.82)
})

test("computePlanQuote supports multi-month terms", async () => {
  const quote = await computePlanQuote({ monthlyPrice: 25.5, termMonths: 3, taxPercent: 18, countryCode: null })
  assert.equal(quote.subtotal, 76.5)
  assert.equal(quote.gst, 13.77)
  assert.equal(quote.total, 90.27)
})

test("computePlanQuote with explicit zero tax stays at subtotal", async () => {
  const quote = await computePlanQuote({ monthlyPrice: 50, termMonths: 1, taxPercent: 0, countryCode: null })
  assert.equal(quote.subtotal, 50)
  assert.ok(quote.total >= 50)
})

test("gateway fee settings are stable per gateway", () => {
  assert.equal(creditFeeSettingsForGateway(null, "wallet").feePercent, 0)
  const unknown = creditFeeSettingsForGateway(null, "not-a-gateway")
  assert.ok(typeof unknown.feePercent === "number" && unknown.feePercent >= 0)
  assert.ok(typeof unknown.fixedFee === "number" && unknown.fixedFee >= 0)
})

test("wallet payments never incur a gateway fee", async () => {
  const fee = await computeGatewayFee({ gateway: "wallet", grossAmount: 1000 })
  assert.equal(fee.feeAmount, 0)
  assert.equal(fee.netAmount, 1000)
})

test("disabled credit keeps top-up amounts whole", async () => {
  const fee = await computeGatewayFee({ gateway: "razorpay", grossAmount: 1000, creditEnabled: false })
  assert.equal(fee.feeAmount, 0)
  assert.equal(fee.netAmount, 1000)
})

test("over-storage math against quota is exact", () => {
  const quota = BigInt(bytesFromGb(100))
  const used = BigInt(bytesFromGb(120))
  const over = resolveOverStorage({ usedBytes: used, storageQuotaBytes: quota, overageEnabled: true, maxStorageCapGb: null })
  assert.equal(over.overStorage, true)
  assert.equal(over.overageGb, 20)
  assert.equal(over.overStoragePercent, 120)
  assert.equal(over.capReached, false)
})

test("storage cap blocks when used exceeds cap even while quota allows", () => {
  const over = resolveOverStorage({ usedBytes: BigInt(bytesFromGb(110)), storageQuotaBytes: BigInt(bytesFromGb(100)), overageEnabled: true, maxStorageCapGb: 105 })
  assert.equal(over.overStorage, true)
  assert.equal(over.overageGb, 10)
  assert.equal(over.capReached, true)
})

test("billable order kinds gate finalization", () => {
  assert.equal(orderKind({ metadata: { kind: "backup_plan" } }), "backup_plan")
  assert.equal(isBillableOrder({ metadata: { kind: "backup_plan" } }), true)
  assert.equal(isBillableOrder({ metadata: { kind: "backup_storage_upgrade" } }), true)
  assert.equal(isBillableOrder({ metadata: { kind: "snapshot_charge" } }), true)
  assert.equal(isBillableOrder({ metadata: { kind: "vm_resize" } }), false)
  assert.equal(isBillableOrder({ metadata: {} }), false)
  assert.equal(isBillableOrder(null), false)
  assert.equal(isBillableOrder({ metadata: { kind: "  BACKUP_PLAN  " } }), true)
})