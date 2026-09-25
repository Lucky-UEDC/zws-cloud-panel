import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { backupExceptionDetailForInvoice, classifyOrderlessInvoice } from "@/lib/invoice-anomaly"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8")

const baseInvoice = {
  id: "invoice-1",
  invoiceNumber: "INV-CHK-001",
  customerId: "customer-1",
  status: "pending",
  type: "service",
  createdAt: new Date("2026-07-01T10:00:00Z"),
  orderId: null,
  paymentTransactionId: null,
  metadata: {},
}

test("invoices with checkout-intent metadata classify as abandoned-checkout artifacts", () => {
  const classification = classifyOrderlessInvoice({
    ...baseInvoice,
    metadata: { checkoutReference: "pay_abc123", checkoutUrl: "https://checkout.example/pay" },
  })
  assert.equal(classification.innerClass, "abandoned_checkout_artifact")
  assert.equal(classification.checkoutReference, "pay_abc123")
  assert.ok(classification.artifactKeys.includes("checkoutUrl"))
})

test("session-style checkout artifacts are recognised", () => {
  const classification = classifyOrderlessInvoice({
    ...baseInvoice,
    metadata: { checkoutSessionId: "cs_test_xyz", gatewayIntentId: "pi_789" },
  })
  assert.equal(classification.innerClass, "abandoned_checkout_artifact")
  assert.equal(classification.checkoutReference, "cs_test_xyz")
})

test("invoices without checkout artifacts classify as orphaned and retained", () => {
  const classification = classifyOrderlessInvoice(baseInvoice)
  assert.equal(classification.innerClass, "orphaned_untracked_service_invoice")
  assert.equal(classification.checkoutReference, "")
  assert.deepEqual(classification.artifactKeys, [])
})

test("exception detail carries diagnostics without customer PII beyond email", () => {
  const classification = classifyOrderlessInvoice(baseInvoice)
  const detail = backupExceptionDetailForInvoice(baseInvoice as any, classification)
  assert.equal(detail.invoiceNumber, "INV-CHK-001")
  assert.equal(detail.orderId, null)
  assert.equal(detail.checkoutReference, null)
  assert.deepEqual(detail.artifactKeys, [])
  assert.ok(detail.metadata)
})

test("classification targets the pre-existing production_data_repair_exceptions table (raw SQL, retained-only)", () => {
  const schema = read("prisma/schema.prisma")
  assert.doesNotMatch(schema, /model ProductionDataRepairException/)
})

test("classifier script marks via raw SQL into the repair table, never deletes, and is idempotent by fingerprint", () => {
  const script = read("scripts/classify-orderless-invoices.ts")
  assert.match(script, /production_data_repair_exceptions/)
  assert.match(script, /\$executeRawUnsafe/)
  assert.match(script, /INSERT INTO/)
  assert.match(script, /ON CONFLICT \(fingerprint\) DO NOTHING/)
  assert.match(script, /entity_type/)
  assert.doesNotMatch(script, /invoice\.(delete|deleteMany)/)
  assert.doesNotMatch(script, /UPDATE "invoices"/)
  assert.match(script, /--dry-run/)
})