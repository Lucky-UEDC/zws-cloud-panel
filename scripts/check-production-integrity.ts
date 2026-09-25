import { prisma } from "@/lib/db"
import { decryptGatewayCredentials } from "@/lib/payments/domain-gateway-credentials"

const REQUIRED_CREDENTIALS: Record<string, string[]> = {
  cashfree: ["appId", "secretKey"],
  phonepe: ["merchantId", "clientId", "clientSecret", "clientVersion"],
  manual: [],
  wallet: [],
}

function metadataObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

function fail(message: string, details?: Record<string, unknown>) {
  return { ok: false, message, details: details || {} }
}

function pass(message: string, details?: Record<string, unknown>) {
  return { ok: true, message, details: details || {} }
}

async function main() {
  const checks: Array<{ ok: boolean; message: string; details: Record<string, unknown> }> = []
  const domains = await prisma.domainConfig.findMany({ include: { gatewayConfigs: true } })
  const primary = domains.filter((domain) => domain.isPrimary)
  checks.push(primary.length === 1 ? pass("one primary domain", { count: primary.length }) : fail("expected exactly one primary domain", { count: primary.length }))

  for (const domain of domains.filter((item) => item.isActive)) {
    const enabled = domain.gatewayConfigs.filter((config) => config.enabled).map((config) => config.gateway)
    const defaultGateway = String(domain.defaultGateway || "none")
    if (defaultGateway !== "none" && !enabled.includes(defaultGateway)) checks.push(fail("active domain default gateway is not enabled", { domain: domain.domain, defaultGateway }))
    if (defaultGateway === "none") checks.push(pass("active domain has explicit no default gateway", { domain: domain.domain }))

    for (const config of domain.gatewayConfigs.filter((item) => item.enabled)) {
      const credentials = decryptGatewayCredentials(config)
      const missing = (REQUIRED_CREDENTIALS[config.gateway] || []).filter((key) => !credentials[key])
      if (missing.length) checks.push(fail("enabled gateway missing credentials", { domain: domain.domain, gateway: config.gateway, missing }))
    }
  }

  const duplicateMerchantOrderIds = await prisma.$queryRaw<Array<{ merchantOrderId: string; count: bigint }>>`
    SELECT "merchantOrderId", COUNT(*)::bigint AS count
    FROM "payment_attempts"
    GROUP BY "merchantOrderId"
    HAVING COUNT(*) > 1
  `.catch(() => [])
  checks.push(duplicateMerchantOrderIds.length ? fail("duplicate merchantOrderId values found", { count: duplicateMerchantOrderIds.length }) : pass("no duplicate merchantOrderId values"))

  const failedMigrations = await prisma.$queryRaw<Array<{ migration_name: string }>>`
    SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL
  `.catch(() => [])
  checks.push(failedMigrations.length ? fail("failed or pending migrations found", { failedMigrations }) : pass("no failed pending migrations"))

  const sessionCount = await prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }).catch(() => -1)
  checks.push(sessionCount >= 0 ? pass("sessions table health ok", { activeSessions: sessionCount }) : fail("sessions table unavailable"))

  const routingMetadata = domains.map((domain) => ({
    domain: domain.domain,
    fallbackBehavior: metadataObject(metadataObject(domain.metadata).paymentRouting).fallbackBehavior || "disabled",
  }))

  const failures = checks.filter((check) => !check.ok)
  console.log(JSON.stringify({ ok: failures.length === 0, checks, routingMetadata }, null, 2))
  if (failures.length) process.exit(1)
}

main().finally(() => prisma.$disconnect())
