import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

function read(path: string) {
  return readFileSync(path, "utf8")
}

const oneTimeHotPaths = [
  "lib/razorpay.ts",
  "lib/payments/gateway-drivers.ts",
  "lib/client/payment-redirect.ts",
  "app/api/payments/create/route.ts",
  "app/api/payments/razorpay/verify/route.ts",
  "app/api/payments/webhook/route.ts",
  "app/api/payment/create-order/route.ts",
]

test("razorpay standard orders are wired into gateway selection and admin settings", () => {
  assert.match(read("lib/payments/unified-gateway.ts"), /"razorpay"/)
  assert.match(read("lib/payments/payment-gateway-admin.ts"), /"razorpay"[\s\S]*"keyId"[\s\S]*"keySecret"[\s\S]*"webhookSecret"/)
  const adminPage = read("app/admin/payments/gateways/page.tsx")
  assert.match(adminPage, /Merchant Name/)
  assert.match(adminPage, /Theme Color/)
  assert.match(adminPage, /Upload Logo/)
  assert.match(adminPage, /updateCredential\("merchantName"/)
  assert.match(adminPage, /updateCredential\("themeColor"/)
  assert.match(adminPage, /"logoUrl"/)
  assert.match(adminPage, /BRANDED_PROVIDERS/)
})

test("razorpay helper creates one-time orders and checkout options", () => {
  const razorpay = read("lib/razorpay.ts")
  assert.match(razorpay, /createRazorpayOrderCheckout/)
  assert.match(razorpay, /razorpayFetch\(args\.gatewayConfig, "\/orders"/)
  assert.match(razorpay, /razorpay_disallowed_billing_path/)
  assert.match(razorpay, /order_id: created\.id/)
  assert.match(razorpay, /razorpayFlow: "order"/)
  assert.match(razorpay, /checkoutFlow: "one_time_order"/)
  assert.match(razorpay, /merchantName/)
  assert.match(razorpay, /themeColor/)
  assert.match(razorpay, /logoUrl/)
})

test("razorpay signatures use order id and payment id only", () => {
  const razorpay = read("lib/razorpay.ts")
  assert.match(razorpay, /verifyRazorpayPaymentSignature/)
  assert.match(razorpay, /`\$\{input\.orderId\}\|\$\{input\.paymentId\}`/)
  assert.match(razorpay, /received\.length !== expected\.length/)
  assert.match(razorpay, /timingSafeEqual/)
})

test("checkout response and browser launcher use standard checkout order id", () => {
  const route = read("app/api/payments/create/route.ts")
  const redirect = read("lib/client/payment-redirect.ts")
  assert.match(route, /razorpayOrderId/)
  assert.match(route, /razorpay_order_id/)
  assert.match(route, /order_id/)
  assert.match(route, /receipt/)
  assert.match(route, /notes/)
  assert.match(route, /customer,\s+invoice,/)
  assert.match(route, /razorpayFlow[\s\S]*"order"/)
  assert.match(redirect, /startRazorpayStandardCheckout/)
  assert.match(redirect, /order_id: checkoutOrderId/)
  assert.match(redirect, /razorpay_order_id/)
  assert.match(redirect, /checkoutOrderId\.startsWith\("order_"\)/)
  assert.match(redirect, /Number\.isInteger\(amount\)/)
  assert.match(redirect, /Razorpay customer prefill is missing/)
  assert.ok(!redirect.includes(["razorpay", "sub" + "scription", "id"].join("_")))
})

test("browser verification finalizes captured standard orders", () => {
  const verify = read("app/api/payments/razorpay/verify/route.ts")
  assert.match(verify, /fetchRazorpayPayment/)
  assert.match(verify, /fetchRazorpayOrder/)
  assert.match(verify, /finalizeSuccessfulPayment/)
  assert.match(verify, /razorpay_checkout_callback/)
  assert.match(verify, /waiting_for_payment_captured_webhook/)
  assert.match(verify, /captured/)
  assert.match(verify, /captureAuthorizedRazorpayPayment/)
})

test("authorized payments use bounded compare-and-swap capture with provider reconciliation", () => {
  const capture = read("lib/payments/razorpay-capture.ts")
  const razorpay = read("lib/razorpay.ts")
  const webhook = read("app/api/payments/webhook/route.ts")
  const migration = read("prisma/migrations/20260711210000_payment_capture_node_drain/migration.sql")
  assert.match(razorpay, /\/payments\/\$\{encodeURIComponent\(paymentId\)\}\/capture/)
  assert.match(capture, /MAX_CAPTURE_ATTEMPTS = 3/)
  assert.match(capture, /paymentAttempt\.updateMany/)
  assert.match(capture, /captureStatus: "processing"/)
  assert.match(capture, /captured_after_ambiguous_response/)
  assert.match(webhook, /captureAuthorizedRazorpayPayment/)
  assert.match(migration, /capture_claimed_at/)
  assert.match(migration, /capture_attempts/)
})

test("singular create-order route forces standard razorpay order flow", () => {
  const route = read("app/api/payment/create-order/route.ts")
  assert.match(route, /gateway: "razorpay"/)
  assert.match(route, /preferredGateway: "razorpay"/)
  assert.match(route, /\/api\/payments\/create/)
})

test("razorpay webhook finalizes only captured one-time payments", () => {
  const webhook = read("app/api/payments/webhook/route.ts")
  assert.match(webhook, /"payment\.authorized"/)
  assert.match(webhook, /"payment\.captured"/)
  assert.match(webhook, /"payment\.failed"/)
  assert.match(webhook, /"refund\.created"/)
  assert.match(webhook, /"refund\.processed"/)
  assert.match(webhook, /"order\.paid"/)
  assert.match(webhook, /let isPaid = \["payment\.captured", "order\.paid"\]\.includes\(eventType\)/)
  assert.match(webhook, /isAuthorized[\s\S]*captureAuthorizedRazorpayPayment/)
  assert.match(webhook, /finalizeSuccessfulPayment/)
  assert.match(webhook, /eventRow\?\.processedAt/)
})

test("vps razorpay hot paths contain only one-time order dependencies", () => {
  const blocked = new RegExp([
    "sub" + "scriptions?\\.create",
    "\\/sub" + "scriptions",
    ["sub" + "scription", "id"].join("_"),
    ["razorpay", "sub" + "scription"].join("_"),
    "razorpay" + "Sub" + "scription",
    "mand" + "ate" + "History",
    "auto" + "pay",
    "mand" + "ate",
  ].join("|"), "i")
  for (const path of oneTimeHotPaths) {
    const content = read(path)
    assert.doesNotMatch(content, blocked, path)
  }
})

test("payment gateway runtime is database-only and provider isolated", () => {
  assert.doesNotMatch(read("lib/payments/runtime-payment-config.ts"), /unstable_cache/)
  assert.match(read("lib/payments/payment-gateway-admin-service.ts"), /findUnique\(\{ where: \{ id: input\.id \} \}/)
  assert.match(read("lib/payments/payment-gateway-admin-service.ts"), /gateway_provider_immutable/)
  assert.match(read("app/api/admin/payment-gateways/[id]/route.ts"), /export async function PATCH/)
  assert.ok(read("app/admin/payments/gateways/page.tsx").includes("/api/admin/payment-gateways/${form.id}"))
  assert.match(read("lib/payments/payment-gateway-admin.ts"), /syncPaymentGatewayCompatibility[\s\S]*return null/)
})

test("failed phonepe recovery is one-notification-per-order-invoice", () => {
  const recovery = read("scripts/recover-failed-phonepe-orders.ts")
  assert.match(recovery, /createdAt:\s*\{\s*gte:\s*since\s*\}/)
  assert.match(recovery, /notificationKey = `phonepe-recovery:\$\{payment\.orderId\}:\$\{payment\.invoiceId\}`/)
  assert.match(recovery, /paymentRetryQueue\.upsert/)
  assert.match(recovery, /sendOrderInvoiceNotification/)
})

test("checkout and razorpay payment initialization are idempotent", () => {
  const helper = read("lib/payments/checkout-idempotency.ts")
  assert.match(helper, /getOrCreateCheckoutSession/)
  assert.match(helper, /checkoutSession\.upsert/)
  assert.match(helper, /PrismaClientKnownRequestError[\s\S]*P2002/)
  assert.match(helper, /pg_advisory_xact_lock/)
  assert.match(helper, /\$executeRaw`SELECT pg_advisory_xact_lock/)
  assert.doesNotMatch(helper, /\$queryRaw(?:Unsafe)?`SELECT pg_advisory_xact_lock/)
  assert.match(helper, /getOrCreateCheckoutPayment/)
  assert.match(helper, /payment\.upsert/)
  assert.match(helper, /paymentAttempt\.upsert/)
  assert.match(helper, /claimPaymentInitialization/)
  assert.match(helper, /resuming_existing_payment/)
  assert.match(helper, /payment_already_completed/)
})

test("terminal checkout payments create a sequential retry while active payments resume", () => {
  const route = read("app/api/payments/create/route.ts")
  assert.match(route, /terminalRetryablePaymentStatus/)
  assert.match(route, /return await startCheckoutSessionPayment/)
  assert.match(route, /attemptCount > 0 \? `\$\{referenceBase\}-R\$\{attemptCount \+ 1\}`/)
  assert.match(route, /latestRazorpayOrderReusable/)
})

test("customer payment routes support the configured payment gateway", () => {
  const create = read("app/api/payments/create/route.ts")
  const wallet = read("lib/wallet-topup.ts")
  const invoicePay = read("app/api/client/invoices/[id]/pay/route.ts")
  const renewal = read("app/api/client/vps/[id]/renew/route.ts")
  assert.match(create, /const preferredGateway = requestedGateway/)
  assert.doesNotMatch(create, /const preferredGateway = requestedGateway \|\| "razorpay"/)
  assert.match(create, /selectGatewayAttemptPlan\(/)
  assert.doesNotMatch(create, /\.filter\(\(gateway: UsableRuntimeGateway\) => gateway\.gateway === "razorpay"\)/)
  assert.match(create, /getOrCreateCheckoutPayment/)
  assert.match(wallet, /String\(config\.gateway \|\| ""\) === "razorpay"/)
  assert.doesNotMatch(invoicePay, /gateway\.gateway === "razorpay"/)
  assert.match(renewal, /String\(config\.gateway\) !== "razorpay"/)
  assert.match(create, /Razorpay Standard Checkout must be configured/)
})

test("payment diagnostics route and operational checks exist", () => {
  assert.match(read("app/admin/system/payment-diagnostics/page.tsx"), /admin\/payments\/diagnostics\/page/)
  assert.match(read("app/api/admin/system/payment-diagnostics/route.ts"), /admin\/payments\/diagnostics\/route/)
  const diagnostics = read("lib/payments/diagnostics.ts")
  assert.match(diagnostics, /paymentOperationalChecks/)
  assert.match(diagnostics, /duplicateKeys/)
  assert.match(diagnostics, /stuckPayments/)
  assert.match(diagnostics, /unprocessedWebhooks/)
  assert.match(diagnostics, /provisionQueue/)
  assert.match(diagnostics, /deadQueue/)
  assert.match(diagnostics, /retryButtons/)
})

test("checkout cleanup deletes only abandoned empty sessions and soft-expires stale attempts", () => {
  const cleanup = read("lib/checkout-reservations.ts")
  assert.match(cleanup, /payments:\s*\{\s*none:\s*\{\s*\}\s*\}/)
  assert.match(cleanup, /checkout_session_abandoned_deleted/)
  assert.match(cleanup, /status:\s*"expired"/)
  assert.match(cleanup, /reservation_expired/)
  assert.doesNotMatch(cleanup, /paymentWebhookEvent\.delete/)
})
