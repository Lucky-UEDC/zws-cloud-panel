#!/usr/bin/env node
import { PrismaClient } from "@prisma/client"
import { getPaymentSettings } from "../lib/settings"
import { encryptGatewayCredentials } from "../lib/payments/domain-gateway-credentials"
import { assertDatabaseUrl } from "../lib/db-url"
import { configuredSiteDomain, requirePublicOrigin } from "../lib/public-url"
import { paymentWebhookUrl } from "../lib/runtime-site-url"

assertDatabaseUrl()

const prisma = new PrismaClient()

function normalizeEnvironment(value?: string | null) {
  const env = String(value || "production").toLowerCase()
  return env === "test" ? "sandbox" : env === "sandbox" ? "sandbox" : "production"
}

async function upsertGateway(input: {
  domainId: string
  gateway: "cashfree" | "phonepe" | "manual" | "wallet"
  enabled: boolean
  environment: string
  displayName: string
  priority: number
  approvedPaymentDomain: string
  webhookUrl?: string | null
  returnUrl?: string | null
  credentials?: Record<string, unknown>
}) {
  const encrypted = encryptGatewayCredentials(input.credentials || {})
  return prisma.domainGatewayConfig.upsert({
    where: {
      domainId_gateway_environment: {
        domainId: input.domainId,
        gateway: input.gateway,
        environment: input.environment,
      },
    },
    update: {
      enabled: input.enabled,
      priority: input.priority,
      displayName: input.displayName,
      approvedPaymentDomain: input.approvedPaymentDomain,
      webhookUrl: input.webhookUrl || null,
      returnUrl: input.returnUrl || null,
      startUrl: null,
      extraConfig: {},
      ...encrypted,
    },
    create: {
      domainId: input.domainId,
      gateway: input.gateway,
      enabled: input.enabled,
      environment: input.environment,
      priority: input.priority,
      displayName: input.displayName,
      approvedPaymentDomain: input.approvedPaymentDomain,
      webhookUrl: input.webhookUrl || null,
      returnUrl: input.returnUrl || null,
      startUrl: null,
      extraConfig: {},
      ...encrypted,
    },
  })
}

async function main() {
  const settings = await getPaymentSettings()
  const domain = configuredSiteDomain()
  const appBaseUrl = requirePublicOrigin()
  const brandName = process.env.SITE_NAME || process.env.APP_NAME || process.env.NEXT_PUBLIC_APP_NAME || "Cloud"
  const enabledGateways = [
    settings.cashfreeEnabled ? "cashfree" : null,
    settings.phonepeEnabled ? "phonepe" : null,
    settings.manualPaymentEnabled ? "manual" : null,
    settings.allowWalletPayments ? "wallet" : null,
  ].filter(Boolean) as string[]
  const requestedDefault = String(settings.defaultGateway || "phonepe")
  const defaultGateway = enabledGateways.includes(requestedDefault) ? requestedDefault : enabledGateways[0] || "manual"

  const domainConfig = await prisma.domainConfig.upsert({
    where: { domain },
    update: {
      displayName: brandName,
      appBaseUrl,
      isPrimary: true,
      isActive: true,
      canonicalRedirectEnabled: false,
      allowedGatewayModes: ["cashfree", "phonepe", "manual", "wallet"],
      defaultGateway,
      fallbackGateway: null,
      metadata: {},
      notes: "Single Cloudflare Tunnel production domain.",
    },
    create: {
      domain,
      displayName: brandName,
      brandName,
      appBaseUrl,
      isPrimary: true,
      isActive: true,
      canonicalRedirectEnabled: false,
      allowedGatewayModes: ["cashfree", "phonepe", "manual", "wallet"],
      defaultGateway,
      fallbackGateway: null,
      metadata: {},
      notes: "Single Cloudflare Tunnel production domain.",
    },
  })

  await prisma.domainConfig.updateMany({
    where: { id: { not: domainConfig.id } },
    data: { isPrimary: false, isActive: false, fallbackGateway: null },
  })

  await upsertGateway({
    domainId: domainConfig.id,
    gateway: "cashfree",
    enabled: Boolean(settings.cashfreeEnabled),
    environment: normalizeEnvironment(settings.cashfreeEnvironment || settings.paymentMode),
    displayName: "Cashfree",
    priority: 10,
    approvedPaymentDomain: domain,
    webhookUrl: paymentWebhookUrl("cashfree", appBaseUrl),
    returnUrl: settings.cashfreeCallbackUrl || `${appBaseUrl}/payment/status?order_id={order_id}`,
    credentials: {
      appId: settings.cashfreeAppId || "",
      secretKey: settings.cashfreeSecretKey || "",
      webhookSecret: settings.cashfreeWebhookSecret || "",
      apiVersion: settings.cashfreeApiVersion || "2023-08-01",
    },
  })

  await upsertGateway({
    domainId: domainConfig.id,
    gateway: "phonepe",
    enabled: Boolean(settings.phonepeEnabled),
    environment: normalizeEnvironment(settings.phonepeEnvironment),
    displayName: "PhonePe",
    priority: 20,
    approvedPaymentDomain: domain,
    webhookUrl: paymentWebhookUrl("phonepe", appBaseUrl),
    returnUrl: `${appBaseUrl}/payment/status?order_id={order_id}`,
    credentials: {
      merchantId: settings.phonepeMerchantId || "",
      clientId: settings.phonepeClientId || "",
      clientSecret: settings.phonepeClientSecret || "",
      webhookUsername: (settings as any).phonepeWebhookUsername || "",
      webhookPassword: (settings as any).phonepeWebhookPassword || settings.phonepeWebhookSecret || "",
      clientVersion: settings.phonepeApiVersion || settings.phonepeIntegrationType || "",
    },
  })

  await upsertGateway({ domainId: domainConfig.id, gateway: "manual", enabled: Boolean(settings.manualPaymentEnabled), environment: "production", displayName: "Manual Payment", priority: 90, approvedPaymentDomain: domain })
  await upsertGateway({ domainId: domainConfig.id, gateway: "wallet", enabled: Boolean(settings.allowWalletPayments), environment: "production", displayName: "Wallet", priority: 80, approvedPaymentDomain: domain })

  console.log(`Payment gateway settings migrated to the single production domain: ${domain}`)
}

main()
  .catch((error) => {
    console.error("Payment settings migration failed:", error?.message || error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
