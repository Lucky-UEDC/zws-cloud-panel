import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const root = process.cwd()

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8")
}

test("checkout idempotency scopes session payment reuse to the requested gateway", () => {
  const source = read("lib/payments/checkout-idempotency.ts")
  assert.match(source, /gateway\?: string \| null/)
  assert.match(source, /findPaymentByIdentity\(\{\s*gateway:\s*input\.gateway,\s*paymentIdempotencyKey,\s*checkoutSessionId:\s*input\.checkoutSessionId,\s*merchantOrderId\s*\}/)
  assert.match(source, /\.\.\.\(gateway \? \{ gateway \} : \{\}\)/)
  assert.doesNotMatch(source, /checkoutSessionId: input\.checkoutSessionId,\s*status: \{ in: \[\.\.\.ACTIVE_PAYMENT_STATUSES/)
})

test("create route resolves cashfree session mode as production/sandbox instead of direct", () => {
  const source = read("app/api/payments/create/route.ts")
  assert.match(source, /function modeForGatewayConfig\(config: any, resolution: ResolvedPaymentGateway \| null\)/)
  assert.match(source, /String\(config\.environment \|\| config\.mode \|\| resolution\?\.gatewayConfig\?\.environment \|\| "sandbox"\)\.toLowerCase\(\) === "production"/)
  assert.doesNotMatch(source, /function modeForGatewayConfig\(config: any, resolution: ResolvedPaymentGateway \| null\) \{\s*return "direct"/)
})

test("create route honors preferred gateway in candidate ordering", () => {
  const source = read("app/api/payments/create/route.ts")
  assert.match(source, /function gatewayCandidatePreferenceRank\(gateway: any, preferredGateway\?: string \| null\)/)
  assert.match(source, /gatewayCandidatePreferenceRank\(a, preferredGateway\)\s*-\s*gatewayCandidatePreferenceRank\(b, preferredGateway\)/)
})

test("create route never reuses a pending other-gateway payment for the selected gateway", () => {
  const source = read("app/api/payments/create/route.ts")
  assert.match(source, /reusedGatewayMatchesSelection\s*=.*String\(latestPayment\?\.gateway \|\| ""\)\.toLowerCase\(\)/)
  assert.match(source, /pendingPaymentStatus\(latestPayment\.status\) && reusedGatewayMatchesSelection/)
  assert.match(source, /\["production", "sandbox"\]\.includes\(String\(latestAttempt\?\.mode \|\| ""\)\.toLowerCase\(\)\)/)
})

test("cashfree runtime supports a non-charging authentication probe and it is wired into diagnostics and admin test", () => {
  const cashfree = read("lib/cashfree.ts")
  assert.match(cashfree, /export async function testCashfreeAuthentication\(config: any\)/)
  assert.match(cashfree, /cashfree_auth_rejected/)
  assert.match(cashfree, /cashfree_auth_ready/)
  const drivers = read("lib/payments/gateway-drivers.ts")
  assert.match(drivers, /testCashfreeAuthentication,/)
  assert.match(drivers, /runLiveAuth && checks\[0\]\.status !== "fail"/)
  const adminTest = read("app/api/admin/payment-gateways/[id]/test/route.ts")
  assert.match(adminTest, /testCashfreeAuthentication/)
  assert.match(adminTest, /production_non_charging_validation/)
  assert.match(adminTest, /lastHealthCheckedAt: new Date\(\)/)
})

test("payment flow emits structured masked diagnostics from order to session", () => {
  const source = read("app/api/payments/create/route.ts")
  assert.match(source, /logPaymentFlowStep\("PAYMENT_FLOW_START",/)
  assert.match(source, /logPaymentFlowStep\("PAYMENT_FLOW_GATEWAY_SELECTED",/)
  assert.match(source, /logPaymentFlowStep\("PAYMENT_FLOW_CHECKOUT_SESSION_CREATED",/)
})

test("checkout bootstrap propagates admin razorpay logo and frontend renders branded gateway marks", () => {
  const bootstrap = read("lib/checkout-bootstrap.ts")
  assert.match(bootstrap, /logo:\s*gateway\.gateway === "razorpay" \? safeGatewayLogo\(gateway\) : null/)
  assert.match(bootstrap, /safeGatewayLogo\(gateway: UsableRuntimeGateway\)/)
  const checkout = read("app/checkout/CheckoutContent.tsx")
  assert.match(checkout, /function GatewayBrandMark/)
  assert.doesNotMatch(checkout, /Smartphone className="h-4 w-4 text-accent" \/>/)
})

test("admin gateway page exposes last test timestamp and show/hide for secret fields", () => {
  const page = read("app/admin/payments/gateways/page.tsx")
  assert.match(page, /lastTestAt \? new Date\(form\.lastTestAt\)\.toLocaleString\(\)/)
  assert.match(page, /revealedCredentials/)
  assert.match(page, /aria-label=\{reveal \? "Hide secret" : "Show secret"\}/)
  const serialize = read("lib/payments/payment-gateway-admin.ts")
  assert.match(serialize, /lastTestAt:\s*row\.lastHealthCheckedAt \|\| null/)
})

test("explicit gateway selection disables fallback loops in session and direct payment flows", () => {
  const source = read("app/api/payments/create/route.ts")
  assert.match(source, /const explicitGatewaySelected = Boolean\(requestedGateway\)/)
  assert.match(source, /input\.explicitGatewaySelected && input\.preferredGateway/)
  // Explicit selection routes through the pure selection policy: the customer's
  // chosen gateway is the ONLY gateway in the attempt order unless its own
  // config opts into failsafe fallback (failsafeEnabled).
  assert.match(source, /selectGatewayAttemptPlan\(\{/)
  assert.match(source, /attemptPlan\.attemptOrder/)
  assert.match(source, /explicitGatewaySelected && preferredGateway/)
  assert.match(source, /directAttemptPlan\.attemptOrder/)
  assert.match(source, /function gatewayUnavailableMessage\(/)
  assert.match(source, /function paymentGatewayMatchesSelection\(/)
})

test("direct-flow reuse is gateway-scoped and ignores a stale pending payment for a different gateway", () => {
  const source = read("app/api/payments/create/route.ts")
  assert.match(source, /paymentGatewayMatchesSelection\(existingPayment, explicitGatewaySelected, preferredGateway\)/)
  assert.match(source, /existing_session_gateway_mismatch/)
  assert.match(source, /existing_session_gateway_mismatch/)
})

test("legacy offer/topup path processes only the explicitly selected gateway", () => {
  const source = read("app/api/payments/create/route.ts")
  assert.match(source, /explicitGatewaySelected\s*&&\s*preferredGateway\s*&&\s*!gatewayPriority\.includes\(preferredGateway as any\)/)
  assert.match(source, /explicit_gateway_unavailable/)
  assert.match(source, /explicitGatewaySelected \? preferredGateway === code : gatewayPriority\.includes\(code\)/)
})

test("frontend hard-checks returned gateway matches selected gateway before starting payment", () => {
  const checkout = read("app/checkout/CheckoutContent.tsx")
  // Gateway mode derives the gateway to verify from the customer's explicit
  // selection; the wallet (Account Credit) path has no gateway to open.
  assert.match(checkout, /const gatewayAtSubmit = method === "gateway" \? selectedGateway : null/)
  assert.match(checkout, /const returnedGateway = String\(data\?\.gateway/)
  // Part 2.6: returned-gateway validation is centralized and blocks mismatches.
  assert.match(checkout, /validateReturnedGateway\(returnedGateway, gatewayAtSubmit\)/)
  assert.match(checkout, /PAYMENT_GATEWAY_MISMATCH/)
  assert.match(checkout, /startPaymentRedirect\(data, \{ push: router\.push, expectedGateway: gatewayAtSubmit \}\)/)
})

test("payment redirect throws immediately when gateway mismatch is detected", () => {
  const source = read("lib/client/payment-redirect.ts")
  assert.match(source, /expectedGateway\?: string \| null/)
  assert.match(source, /PAYMENT_GATEWAY_MISMATCH/)
  assert.match(source, /gateway !== expectedGateway/)
})

test("payment error mapping exposes a user-friendly message for gateway_unavailable", () => {
  const source = read("lib/client/payment-errors.ts")
  assert.match(source, /gateway_unavailable/)
  assert.match(source, /Selected payment gateway is currently unavailable/)
})

test("razorpay checkout branding falls back to the ZWS Cloud logo when no custom logo is configured", () => {
  const source = read("lib/razorpay.ts")
  assert.match(source, /\/icon\.svg/)
  assert.match(source, /ZWS Cloud/)
})

test("gateway brand mark shows official razorpay and cashfree logos as fallbacks", () => {
  const source = read("app/checkout/CheckoutContent.tsx")
  assert.match(source, /\/gateway-logos\/razorpay-logo\.svg/)
  assert.match(source, /\/gateway-logos\/cashfree-logo\.png/)
  assert.doesNotMatch(source, /styles\[gateway\.code\] \|\| styles\.cashfree/)
})