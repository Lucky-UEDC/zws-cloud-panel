/**
 * Pure payment-gateway selection policy.
 *
 * Explicit customer selection always wins over configured gateway priority.
 * Priority is used ONLY for automatic routing (no explicit selection).
 * Failsafe fallback is permitted ONLY when the selected gateway opts in via
 * `failsafeEnabled` AND another eligible gateway exists — never silently.
 */

export type GatewayCandidateSnapshot = {
  gateway: string
  /** Configured priority. Lower number = higher priority. */
  priority?: number | null
  /** Whether failover to another gateway is permitted when this one fails. */
  failsafeEnabled?: boolean | null
}

export type GatewayAttemptPlan = {
  /** "explicit" — only the customer-selected gateway may be tried. */
  policy: "explicit" | "explicit_failsafe" | "automatic"
  /** The gateway the customer explicitly requested, if any. */
  requestedGateway: string | null
  /** Gateways to attempt, in order. Length 0 = nothing is eligible. */
  attemptOrder: string[]
  /** Whether trying a later gateway in `attemptOrder` is permitted. */
  fallbackAllowed: boolean
}

export function normalizeGatewayName(value: unknown): string {
  return String(value || "").trim().toLowerCase()
}

/**
 * Sort gateway candidates with the explicitly preferred gateway first (when an
 * explicit preference is supplied and this is an explicit selection), then by
 * configured priority, then by gateway name as a stable tie-break.
 */
export function rankGatewayCandidates<T extends GatewayCandidateSnapshot>(
  candidates: T[],
  options: { preferredGateway?: string | null; explicitSelection: boolean },
): T[] {
  const preferred = options.explicitSelection ? normalizeGatewayName(options.preferredGateway) : ""
  return candidates.slice().sort((a, b) => {
    const aName = normalizeGatewayName(a.gateway)
    const bName = normalizeGatewayName(b.gateway)
    const aPreferred = preferred && aName === preferred ? 0 : 1
    const bPreferred = preferred && bName === preferred ? 0 : 1
    if (aPreferred !== bPreferred) return aPreferred - bPreferred
    const priorityDelta = Number(a.priority ?? 100) - Number(b.priority ?? 100)
    if (priorityDelta !== 0) return priorityDelta
    return aName.localeCompare(bName)
  })
}

/**
 * Compute the gateway attempt plan for a payment initialization request.
 *
 * - Explicit selection (customer picked a gateway): ONLY that gateway may be
 *   initialized. A fallback chain is appended ONLY when the selected gateway's
 *   config has `failsafeEnabled` and another gateway is eligible. The fallback
 *   chain never reorders or hides the primary: the selected gateway is always
 *   attempted first.
 * - Automatic (no explicit selection): all eligible gateways in configured
 *   priority order.
 */
export function selectGatewayAttemptPlan(input: {
  candidates: GatewayCandidateSnapshot[]
  preferredGateway?: string | null
  explicitSelection: boolean
}): GatewayAttemptPlan {
  const requested = normalizeGatewayName(input.preferredGateway)
  const ranked = rankGatewayCandidates(input.candidates, {
    preferredGateway: input.explicitSelection ? requested : null,
    explicitSelection: input.explicitSelection,
  })
  const eligible = ranked.map((candidate) => normalizeGatewayName(candidate.gateway)).filter(Boolean)

  if (input.explicitSelection && requested) {
    const primary = ranked.find((candidate) => normalizeGatewayName(candidate.gateway) === requested) || null
    if (!primary || !eligible.includes(requested)) {
      // The requested gateway is not eligible — do NOT substitute another one.
      return { policy: "explicit", requestedGateway: requested, attemptOrder: [], fallbackAllowed: false }
    }
    const fallbackAllowed = Boolean(primary.failsafeEnabled) && eligible.some((gateway) => gateway !== requested)
    const attemptOrder = fallbackAllowed
      ? [requested, ...eligible.filter((gateway) => gateway !== requested)]
      : [requested]
    return {
      policy: fallbackAllowed ? "explicit_failsafe" : "explicit",
      requestedGateway: requested,
      attemptOrder,
      fallbackAllowed,
    }
  }

  return { policy: "automatic", requestedGateway: null, attemptOrder: eligible, fallbackAllowed: true }
}

/**
 * Validate that the gateway returned by the payment backend matches the one the
 * customer explicitly requested. Mismatch must STOP the checkout — never open
 * the returned (possibly different) gateway.
 */
export function validateReturnedGateway(
  returnedGateway: unknown,
  requestedGateway?: string | null,
): { ok: boolean; reason?: string } {
  const returned = normalizeGatewayName(returnedGateway)
  const requested = normalizeGatewayName(requestedGateway)
  if (!returned) return { ok: false, reason: "Payment gateway was not returned." }
  if (requested && returned !== requested) {
    return {
      ok: false,
      reason: `Payment gateway mismatch detected: requested ${requested}, returned ${returned}.`,
    }
  }
  return { ok: true }
}

/** Human label for a gateway code, safe for customer-facing messages. */
export function gatewayDisplayName(gateway: string): string {
  const name = normalizeGatewayName(gateway)
  if (name === "razorpay") return "Razorpay"
  if (name === "cashfree") return "Cashfree"
  if (name === "phonepe") return "PhonePe"
  return name || "payment gateway"
}