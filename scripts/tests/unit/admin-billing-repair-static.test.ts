import { readFileSync } from "node:fs"
import { test } from "node:test"
import assert from "node:assert/strict"

function read(path: string) {
  return readFileSync(path, "utf8")
}

test("admin billing repair schema includes impersonation tokens and add-on pricing", () => {
  const schema = read("prisma/schema.prisma")

  assert.match(schema, /model AdminCustomerImpersonationToken/)
  assert.match(schema, /tokenHash\s+String\s+@unique/)
  assert.match(schema, /consumedAt\s+DateTime\?/)
  assert.match(schema, /backupEnabled\s+Boolean\s+@default\(false\)/)
  assert.match(schema, /snapshotIncludedCount\s+Int\s+@default\(0\)/)
  assert.match(schema, /bandwidthOveragePrice\s+Decimal\s+@default\(0\)/)
  assert.match(schema, /extraIpv4Price\s+Decimal\s+@default\(0\)/)
})

test("customer deletion uses guarded shared backend flow", () => {
  const helper = read("lib/customer-deletion.ts")
  const route = read("app/api/admin/customers/[id]/route.ts")
  const bulk = read("app/api/admin/customers/bulk/route.ts")

  assert.match(helper, /export async function deleteCustomerSafely/)
  assert.match(helper, /ACTIVE_ORDER_STATUSES/)
  assert.match(helper, /LIVE_SERVICE_STATUSES/)
  assert.match(helper, /blockers/)
  assert.match(route, /deleteCustomerSafely/)
  assert.match(route, /status:\s*409/)
  assert.match(bulk, /blockedIds/)
})

test("invoice editor and creation APIs expose live invoice repair paths", () => {
  const invoiceRoute = read("app/api/admin/invoices/[id]/route.ts")
  const invoiceCreate = read("app/api/admin/invoices/route.ts")
  const editor = read("app/admin/customers/[id]/invoices/[invoiceId]/edit/page.tsx")
  const newInvoice = read("app/admin/invoices/new/page.tsx")

  assert.match(invoiceRoute, /export async function GET/)
  assert.match(invoiceRoute, /taxRate/)
  assert.match(invoiceCreate, /handlePaidInvoice/)
  assert.match(invoiceCreate, /createInvoiceForOrder/)
  assert.match(invoiceCreate, /paymentUrl/)
  assert.match(invoiceCreate, /orderCreationPolicy/)
  assert.match(editor, /invoiceId/)
  assert.match(newInvoice, /Step 1/)
  assert.match(newInvoice, /Step 2/)
  assert.match(newInvoice, /Step 3/)
  assert.match(newInvoice, /Existing Product/)
  assert.match(newInvoice, /Custom Product/)
})

test("admin customer impersonation is short-lived and single-use", () => {
  const helper = read("lib/admin-customer-impersonation.ts")
  const issueRoute = read("app/api/admin/customers/[id]/impersonation-token/route.ts")
  const consumeRoute = read("app/admin/impersonate/[token]/route.ts")
  const proxy = read("proxy.ts")

  assert.match(helper, /ADMIN_CUSTOMER_IMPERSONATION_TTL_MS\s*=\s*2 \* 60 \* 1000/)
  assert.match(helper, /expiresAt\s*=\s*new Date\(Date\.now\(\) \+ ADMIN_CUSTOMER_IMPERSONATION_TTL_MS\)/)
  assert.match(helper, /if \(row\.consumedAt\)/)
  assert.match(helper, /const now = new Date/)
  assert.match(helper, /consumedAt:\s*now/)
  assert.match(issueRoute, /createAdminCustomerImpersonationToken/)
  assert.match(consumeRoute, /consumeAdminCustomerImpersonationToken/)
  assert.match(consumeRoute, /x-forwarded-host/)
  assert.match(consumeRoute, /x-forwarded-proto/)
  assert.match(consumeRoute, /issueSession/)
  assert.match(consumeRoute, /SESSION_COOKIE_NAMES\.client/)
  assert.match(consumeRoute, /response\.cookies\.set/)
  assert.match(consumeRoute, /\/client-area/)
  assert.match(proxy, /path\.startsWith\('\/admin\/impersonate\/'\)/)
})

test("product add-on pricing is wired into admin, public, and checkout surfaces", () => {
  const save = read("lib/admin-product-save.ts")
  const publicProducts = read("lib/public-products.ts")
  const form = read("components/admin/product-form.tsx")
  const checkout = read("app/checkout/CheckoutContent.tsx")
  const bootstrap = read("lib/checkout-bootstrap.ts")

  for (const file of [save, publicProducts, form, checkout]) {
    assert.match(file, /backupEnabled/)
    assert.match(file, /snapshot/)
    assert.match(file, /extraIpv4/)
  }
  assert.match(bootstrap, /backupEnabled/)
  assert.match(bootstrap, /snapshotCount/)
  assert.match(bootstrap, /ipv4Count/)
  assert.match(form, /Add-on Pricing/)
  assert.match(checkout, /addOns/)
})
