import { prisma } from "@/lib/db"
import { decryptGatewayCredentials, encryptGatewayCredentials } from "@/lib/payments/domain-gateway-credentials"

const LEGACY_KEYS = new Set(["saltKey", "saltIndex", "PHONEPE_SALT_KEY", "PHONEPE_SALT_INDEX", "xVerify", "X_VERIFY"])

function stripLegacyCredentials(value: Record<string, unknown>) {
  const next: Record<string, unknown> = {}
  let changed = false
  for (const [key, entry] of Object.entries(value || {})) {
    if (LEGACY_KEYS.has(key)) {
      changed = true
      continue
    }
    next[key] = entry
  }
  return { changed, next }
}

async function sanitizePaymentGateways() {
  const rows = await (prisma as any).paymentGateway.findMany({
    where: { OR: [{ code: "phonepe" }, { provider: "phonepe" }] },
  }).catch(() => [])
  let changed = 0
  for (const row of rows) {
    const encrypted = row.configEncrypted && row.configIv && row.configTag
      ? decryptGatewayCredentials({ credentialsEnc: row.configEncrypted, credentialsIv: row.configIv, credentialsTag: row.configTag })
      : null
    const plain = encrypted || (row.credentials && typeof row.credentials === "object" && !Array.isArray(row.credentials) ? row.credentials : {})
    const stripped = stripLegacyCredentials(plain as Record<string, unknown>)
    if (!stripped.changed) continue
    const encryptedNext = encryptGatewayCredentials(stripped.next)
    await (prisma as any).paymentGateway.update({
      where: { id: row.id },
      data: {
        credentials: {},
        configEncrypted: encryptedNext.credentialsEnc,
        configIv: encryptedNext.credentialsIv,
        configTag: encryptedNext.credentialsTag,
      },
    })
    changed += 1
  }
  return changed
}

async function sanitizeDomainGatewayConfigs() {
  const rows = await (prisma as any).domainGatewayConfig.findMany({ where: { gateway: "phonepe" } }).catch(() => [])
  let changed = 0
  for (const row of rows) {
    if (!row.credentialsEnc || !row.credentialsIv || !row.credentialsTag) continue
    const plain = decryptGatewayCredentials(row)
    const stripped = stripLegacyCredentials(plain)
    if (!stripped.changed) continue
    const encryptedNext = encryptGatewayCredentials(stripped.next)
    await (prisma as any).domainGatewayConfig.update({
      where: { id: row.id },
      data: encryptedNext,
    })
    changed += 1
  }
  return changed
}

async function main() {
  const [paymentGateways, domainGatewayConfigs] = await Promise.all([
    sanitizePaymentGateways(),
    sanitizeDomainGatewayConfigs(),
  ])
  console.log(JSON.stringify({ success: true, paymentGateways, domainGatewayConfigs }))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
