import assert from "node:assert/strict"
import test from "node:test"
import {
  selectGatewayAttemptPlan,
  rankGatewayCandidates,
  validateReturnedGateway,
  normalizeGatewayName,
} from "@/lib/payments/gateway-selection"

// Admin configuration as reported in the live problem report:
// Cashfree: enabled, priority 10. Razorpay: enabled, priority 15.
const CANDIDATES = [
  { gateway: "cashfree", priority: 10, failsafeEnabled: false },
  { gateway: "razorpay", priority: 15, failsafeEnabled: false },
]

function attempt(candidates = CANDIDATES, preferred?: string | null, failsafe?: boolean) {
  return selectGatewayAttemptPlan({
    candidates: candidates.map((c) => ({ ...c, failsafeEnabled: failsafe ?? c.failsafeEnabled })),
    preferredGateway: preferred,
    explicitSelection: Boolean(preferred),
  })
}

// CASE 1 — preferredGateway = razorpay → Razorpay only.
test("PART27 CASE 1: explicit razorpay selection never opens cashfree", () => {
  const plan = attempt(CANDIDATES, "razorpay")
  assert.equal(plan.policy, "explicit")
  assert.deepEqual(plan.attemptOrder, ["razorpay"])
  assert.equal(plan.requestedGateway, "razorpay")
  assert.equal(plan.fallbackAllowed, false)
})

// CASE 2 — preferredGateway = cashfree → Cashfree only (even though priority
// config differs, the customer's explicit selection is authoritative).
test("PART27 CASE 2: explicit cashfree selection never opens razorpay", () => {
  const plan = attempt(CANDIDATES, "cashfree")
  assert.equal(plan.policy, "explicit")
  assert.deepEqual(plan.attemptOrder, ["cashfree"])
  assert.equal(plan.requestedGateway, "cashfree")
})

// CASE 3 — preferred = cashfree, failsafe = false, cashfree fails → NO fallback.
test("PART27 CASE 3: failsafe disabled -> no fallback to another gateway", () => {
  const plan = attempt(CANDIDATES, "cashfree", false)
  assert.equal(plan.policy, "explicit")
  assert.deepEqual(plan.attemptOrder, ["cashfree"])
  assert.equal(plan.fallbackAllowed, false)
})

// CASE 4 — preferred = cashfree, failsafe = true, cashfree fails → cashfree
// attempted first, then eligible fallback gateways in priority order.
test("PART27 CASE 4: failsafe enabled -> fallback allowed but primary first", () => {
  const reversed = [
    { gateway: "razorpay", priority: 1, failsafeEnabled: true },
    { gateway: "cashfree", priority: 99, failsafeEnabled: true },
  ]
  const plan = attempt(reversed, "cashfree", true)
  assert.equal(plan.policy, "explicit_failsafe")
  assert.deepEqual(plan.attemptOrder, ["cashfree", "razorpay"]) // primary first, fallback after
  assert.equal(plan.fallbackAllowed, true)
})

test("PART27 CASE 4b: failsafe fallback respects configured priority order", () => {
  const twoFallbacks = [
    { gateway: "cashfree", priority: 10, failsafeEnabled: true },
    { gateway: "razorpay", priority: 15, failsafeEnabled: true },
    { gateway: "phonepe", priority: 20, failsafeEnabled: true },
  ]
  const plan = attempt(twoFallbacks, "cashfree", true)
  assert.deepEqual(plan.attemptOrder, ["cashfree", "razorpay", "phonepe"])
})

// CASE 5 — no preferred gateway → priority-based automatic selection.
test("PART27 CASE 5: automatic routing uses configured priority (cashfree 10 < razorpay 15)", () => {
  const plan = selectGatewayAttemptPlan({
    candidates: CANDIDATES,
    preferredGateway: null,
    explicitSelection: false,
  })
  assert.equal(plan.policy, "automatic")
  assert.equal(plan.requestedGateway, null)
  assert.deepEqual(plan.attemptOrder, ["cashfree", "razorpay"]) // priority order, no razorpay bias
})

test("PART27 CASE 5b: disabled/absent gateways are not in the attempt order", () => {
  const plan = selectGatewayAttemptPlan({
    candidates: [CANDIDATES[0]],
    preferredGateway: "razorpay",
    explicitSelection: true,
  })
  // The requested gateway is not even configured/eligible -> empty order, no
  // silent substitution with cashfree.
  assert.deepEqual(plan.attemptOrder, [])
})

// CASE 6 — returned gateway differs from requested → validation fails.
test("PART27 CASE 6: returned gateway mismatch is blocked", () => {
  const check = validateReturnedGateway("razorpay", "cashfree")
  assert.equal(check.ok, false)
  assert.match(check.reason || "", /mismatch/i)
  assert.equal(validateReturnedGateway("cashfree", "cashfree").ok, true)
  assert.equal(validateReturnedGateway("", "cashfree").ok, false)
})

test("PART27: ranking puts an explicit preference first even when its priority is worse", () => {
  const ranked = rankGatewayCandidates(CANDIDATES, { preferredGateway: "razorpay", explicitSelection: true })
  assert.equal(normalizeGatewayName(ranked[0].gateway), "razorpay")
  const automatic = rankGatewayCandidates(CANDIDATES, { preferredGateway: "razorpay", explicitSelection: false })
  // In automatic mode the "preferred" label must NOT bias the order.
  assert.equal(normalizeGatewayName(automatic[0].gateway), "cashfree")
})

test("PART27: explicit selection of an unavailable gateway fails loudly, never substitutes", () => {
  const plan = selectGatewayAttemptPlan({
    candidates: [{ gateway: "razorpay", priority: 5, failsafeEnabled: true }],
    preferredGateway: "cashfree",
    explicitSelection: true,
  })
  assert.deepEqual(plan.attemptOrder, [])
  assert.equal(plan.requestedGateway, "cashfree")
})