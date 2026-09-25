import { prisma } from "@/lib/db"
import { getGatewayDriver } from "@/lib/payments/gateway-drivers"
import { classifyGatewayFailure, ENTERPRISE_GATEWAYS, type EnterpriseGateway, type GatewayInitializeInput, type GatewaySession } from "@/lib/payments/gateway-driver"

const PRIORITY = new Map(ENTERPRISE_GATEWAYS.map((gateway, index) => [gateway, index + 1]))
const BLOCKED_HEALTH = new Set(["open", "down", "disabled"])

export type GatewayCandidate = { gateway: EnterpriseGateway; config: any; health: string; priority: number }

export async function orderedEnterpriseGatewayCandidates(configs: any[], preferred?: string | null): Promise<GatewayCandidate[]> {
  const healthRows = await (prisma as any).paymentGateway.findMany({ where: { provider: { in: [...ENTERPRISE_GATEWAYS] }, enabled: true, active: true } }).catch(() => [])
  const healthByGateway = new Map<string, string>(healthRows.map((row: any) => [String(row.provider || row.code).toLowerCase(), String(row.lastHealthStatus || "unknown").toLowerCase()] as [string, string]))
  return configs
    .map((config) => ({ gateway: String(config.gateway || config.provider || config.code || "").toLowerCase() as EnterpriseGateway, config, health: healthByGateway.get(String(config.gateway || config.provider || config.code || "").toLowerCase()) || String(config.healthStatus || "unknown").toLowerCase(), priority: PRIORITY.get(String(config.gateway || config.provider || config.code || "").toLowerCase() as EnterpriseGateway) || 100 }))
    .filter((candidate) => ENTERPRISE_GATEWAYS.includes(candidate.gateway) && candidate.config.enabled !== false && !BLOCKED_HEALTH.has(candidate.health))
    .sort((a, b) => {
      if (preferred && a.gateway === preferred && b.gateway !== preferred) return -1
      if (preferred && b.gateway === preferred && a.gateway !== preferred) return 1
      return a.priority - b.priority
    })
}

async function safeToFailOver(candidate: GatewayCandidate, session: GatewaySession | null) {
  if (!session?.gatewayOrderId) return true
  const driver = getGatewayDriver(candidate.gateway)
  const verification = await driver.verify({ gatewayConfig: candidate.config, gatewayOrderId: session.gatewayOrderId })
  if (["authorized", "captured", "unknown"].includes(verification.state)) return false
  const cancelled = await driver.cancel({ gatewayConfig: candidate.config, gatewayOrderId: session.gatewayOrderId })
  return !["authorized", "captured", "unknown"].includes(cancelled.state)
}

export async function initializeWithFailover(input: Omit<GatewayInitializeInput, "gatewayConfig"> & { candidates: GatewayCandidate[]; onAttempt?: (event: { gateway: EnterpriseGateway; status: string; code?: string; retryable?: boolean }) => Promise<void> }) {
  let lastFailure: ReturnType<typeof classifyGatewayFailure> | null = null
  for (const candidate of input.candidates) {
    const driver = getGatewayDriver(candidate.gateway)
    let session: GatewaySession | null = null
    await input.onAttempt?.({ gateway: candidate.gateway, status: "started" })
    try {
      session = await driver.initialize({ ...input, gatewayConfig: candidate.config })
      await input.onAttempt?.({ gateway: candidate.gateway, status: "session_created" })
      return { session, candidate }
    } catch (error) {
      const failure = driver.classifyError(error, "initialize")
      lastFailure = failure
      await input.onAttempt?.({ gateway: candidate.gateway, status: failure.ambiguous ? "reconciliation_required" : "failed", code: failure.code, retryable: failure.retryable })
      if (failure.ambiguous || !(await safeToFailOver(candidate, session))) {
        throw Object.assign(failure, { code: "gateway_outcome_ambiguous", ambiguous: true })
      }
    }
  }
  throw lastFailure || Object.assign(new Error("No enabled payment gateway is available."), { code: "no_gateway_available", retryable: true })
}
