import { z } from "zod"
import { revalidateRuntimeConfig } from "@/lib/runtime-config"
import { prisma } from "@/lib/db"
import { decryptSecretValue, encryptSecretValue } from "@/lib/secret-crypto"
import { maskSecret, updateAdminSettings } from "@/lib/settings"
import { upsertEmailConfig } from "@/lib/email/config"

const MASKED_PREFIX = "••••"

function isMasked(value: unknown) {
  const text = String(value || "")
  return text === "__MASKED__" || text.startsWith(MASKED_PREFIX)
}

function keepOrEncrypt(value: unknown, previous?: string | null) {
  if (value === undefined || isMasked(value)) return previous || ""
  const text = String(value || "")
  return text ? encryptSecretValue(text) : ""
}

function decrypt(value?: string | null) {
  return value ? decryptSecretValue(value) : ""
}

async function currentRow() {
  const existing = await (prisma as any).systemSetting.findFirst({ where: { active: true }, orderBy: { updatedAt: "desc" } })
  if (existing) return existing
  return (prisma as any).systemSetting.create({ data: { active: true } })
}

export function publicSystemSettings(row: any) {
  return {
    siteName: row?.siteName || "",
    brandName: row?.brandName || "",
    supportEmail: row?.supportEmail || "",
    smtpHost: row?.smtpHost || "",
    smtpPort: row?.smtpPort || 587,
    smtpSecure: Boolean(row?.smtpSecure),
    smtpUser: row?.smtpUser || "",
    smtpPass: maskSecret(decrypt(row?.smtpPassEncrypted)),
    smtpFrom: row?.smtpFrom || "",
    googleAnalyticsId: row?.googleAnalyticsId || "",
    metaPixelId: row?.metaPixelId || "",
    tawkPropertyId: row?.tawkPropertyId || "",
    crispWebsiteId: row?.crispWebsiteId || "",
    customHeadScript: row?.customHeadScript || "",
    customBodyScript: row?.customBodyScript || "",
    analyticsUpdatedAt: row?.analyticsUpdatedAt?.toISOString?.() || row?.analyticsUpdatedAt || null,
    analyticsVersion: row?.analyticsVersion || 1,
    cashfreeAppId: row?.cashfreeAppId || "",
    cashfreeSecret: maskSecret(decrypt(row?.cashfreeSecretEncrypted)),
    cashfreeWebhookSecret: maskSecret(decrypt(row?.cashfreeWebhookSecretEncrypted)),
    phonepeMerchantId: row?.phonepeMerchantId || "",
    phonepeClientId: row?.phonepeClientId || "",
    phonepeClientVersion: row?.phonepeClientVersion || "",
    phonepeClientSecret: maskSecret(decrypt(row?.phonepeClientSecretEncrypted)),
    phonepeWebhookUsername: row?.phonepeWebhookUsername || "",
    phonepeWebhookPassword: maskSecret(decrypt(row?.phonepeWebhookPasswordEncrypted)),
    phonepeWebhookSecret: maskSecret(decrypt(row?.phonepeWebhookSecretEncrypted)),
    proxmoxHost: row?.proxmoxHost || "",
    proxmoxNode: row?.proxmoxNode || "",
    proxmoxTokenId: row?.proxmoxTokenId || "",
    proxmoxTokenSecret: maskSecret(decrypt(row?.proxmoxTokenSecretEncrypted)),
    proxmoxVerifyTls: row?.proxmoxVerifyTls !== false,
    proxmoxVncUser: row?.proxmoxVncUser || "",
    proxmoxVncPassword: maskSecret(decrypt(row?.proxmoxVncPasswordEncrypted)),
    ramThresholdPercent: Number(row?.ramThresholdPercent || 90),
    maintenanceMode: Boolean(row?.maintenanceMode),
    autoFailover: row?.autoFailover !== false,
    updatedAt: row?.updatedAt?.toISOString?.() || row?.updatedAt || null,
  }
}

export async function getPublicSystemSettings() {
  return publicSystemSettings(await currentRow())
}

const emailSchema = z.object({
  smtpHost: z.string().trim().max(255).optional().default(""),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional().default(587),
  smtpSecure: z.boolean().optional().default(false),
  smtpUser: z.string().trim().max(255).optional().default(""),
  smtpPass: z.string().optional().default(""),
  smtpFrom: z.string().email().or(z.literal("")).optional().default(""),
})

const paymentsSchema = z.object({
  cashfreeAppId: z.string().trim().max(255).optional().default(""),
  cashfreeSecret: z.string().optional().default(""),
  cashfreeWebhookSecret: z.string().optional().default(""),
  phonepeMerchantId: z.string().trim().max(255).optional().default(""),
  phonepeClientId: z.string().trim().max(255).optional().default(""),
  phonepeClientVersion: z.string().trim().max(32).optional().default(""),
  phonepeClientSecret: z.string().optional().default(""),
  phonepeWebhookUsername: z.string().trim().max(255).optional().default(""),
  phonepeWebhookPassword: z.string().optional().default(""),
  phonepeWebhookSecret: z.string().optional().default(""),
})

const infrastructureSchema = z.object({
  proxmoxHost: z.string().trim().max(255).optional().default(""),
  proxmoxNode: z.string().trim().max(120).optional().default(""),
  proxmoxTokenId: z.string().trim().max(255).optional().default(""),
  proxmoxTokenSecret: z.string().optional().default(""),
  proxmoxVerifyTls: z.boolean().optional().default(true),
  proxmoxVncUser: z.string().trim().max(120).optional().default(""),
  proxmoxVncPassword: z.string().optional().default(""),
  ramThresholdPercent: z.coerce.number().int().min(1).max(100).optional().default(90),
  maintenanceMode: z.boolean().optional().default(false),
  autoFailover: z.boolean().optional().default(true),
})

const analyticsSchema = z.object({
  googleAnalyticsId: z.string().trim().regex(/^$|^G-[A-Z0-9]+$/i, "Use a GA4 measurement ID like G-XXXXXXXXXX.").optional().default(""),
  metaPixelId: z.string().trim().regex(/^$|^[0-9]{5,30}$/, "Use a numeric Meta Pixel ID.").optional().default(""),
  tawkPropertyId: z.string().trim().max(120).optional().default(""),
  crispWebsiteId: z.string().trim().max(120).optional().default(""),
  customHeadScript: z.string().max(20000).optional().default(""),
  customBodyScript: z.string().max(20000).optional().default(""),
})

export async function updateSystemEmailSettings(input: unknown, updatedBy?: string) {
  const parsed = emailSchema.parse(input)
  const previous = await currentRow()
  const row = await (prisma as any).systemSetting.update({
    where: { id: previous.id },
    data: {
      smtpHost: parsed.smtpHost,
      smtpPort: parsed.smtpPort,
      smtpSecure: parsed.smtpSecure,
      smtpUser: parsed.smtpUser,
      smtpPassEncrypted: keepOrEncrypt(parsed.smtpPass, previous.smtpPassEncrypted),
      smtpFrom: parsed.smtpFrom,
      updatedBy,
    },
  })
  const smtpPass = isMasked(parsed.smtpPass) ? decrypt(previous.smtpPassEncrypted) : parsed.smtpPass
  await upsertEmailConfig({
    smtpHost: parsed.smtpHost,
    smtpPort: parsed.smtpPort,
    smtpSecure: parsed.smtpSecure,
    smtpUser: parsed.smtpUser,
    smtpPass,
    fromEmail: parsed.smtpFrom,
    enabled: Boolean(parsed.smtpHost && parsed.smtpFrom),
  }).catch(() => null)
  return publicSystemSettings(row)
}

export async function updateSystemPaymentSettings(input: unknown, updatedBy?: string) {
  const parsed = paymentsSchema.parse(input)
  const previous = await currentRow()
  const row = await (prisma as any).systemSetting.update({
    where: { id: previous.id },
    data: {
      cashfreeAppId: parsed.cashfreeAppId,
      cashfreeSecretEncrypted: keepOrEncrypt(parsed.cashfreeSecret, previous.cashfreeSecretEncrypted),
      cashfreeWebhookSecretEncrypted: keepOrEncrypt(parsed.cashfreeWebhookSecret, previous.cashfreeWebhookSecretEncrypted),
      phonepeMerchantId: parsed.phonepeMerchantId,
      phonepeClientId: parsed.phonepeClientId,
      phonepeClientVersion: parsed.phonepeClientVersion,
      phonepeClientSecretEncrypted: keepOrEncrypt(parsed.phonepeClientSecret, previous.phonepeClientSecretEncrypted),
      phonepeWebhookUsername: parsed.phonepeWebhookUsername,
      phonepeWebhookPasswordEncrypted: keepOrEncrypt(parsed.phonepeWebhookPassword, previous.phonepeWebhookPasswordEncrypted),
      phonepeWebhookSecretEncrypted: keepOrEncrypt(parsed.phonepeWebhookSecret, previous.phonepeWebhookSecretEncrypted),
      updatedBy,
    },
  })
  await updateAdminSettings("payments", {
    cashfreeAppId: parsed.cashfreeAppId,
    cashfreeSecretKey: isMasked(parsed.cashfreeSecret) ? decrypt(previous.cashfreeSecretEncrypted) : parsed.cashfreeSecret,
    cashfreeWebhookSecret: isMasked(parsed.cashfreeWebhookSecret) ? decrypt(previous.cashfreeWebhookSecretEncrypted) : parsed.cashfreeWebhookSecret,
    phonepeMerchantId: parsed.phonepeMerchantId,
    phonepeClientId: parsed.phonepeClientId,
    phonepeClientSecret: isMasked(parsed.phonepeClientSecret) ? decrypt(previous.phonepeClientSecretEncrypted) : parsed.phonepeClientSecret,
    phonepeApiVersion: parsed.phonepeClientVersion,
    phonepeWebhookUsername: parsed.phonepeWebhookUsername,
    phonepeWebhookPassword: isMasked(parsed.phonepeWebhookPassword) ? decrypt(previous.phonepeWebhookPasswordEncrypted) : parsed.phonepeWebhookPassword,
    phonepeWebhookSecret: isMasked(parsed.phonepeWebhookSecret) ? decrypt(previous.phonepeWebhookSecretEncrypted) : parsed.phonepeWebhookSecret,
  }, updatedBy).catch(() => null)
  return publicSystemSettings(row)
}

export async function updateSystemInfrastructureSettings(input: unknown, updatedBy?: string) {
  const parsed = infrastructureSchema.parse(input)
  const previous = await currentRow()
  const row = await (prisma as any).systemSetting.update({
    where: { id: previous.id },
    data: {
      proxmoxHost: parsed.proxmoxHost,
      proxmoxNode: parsed.proxmoxNode,
      proxmoxTokenId: parsed.proxmoxTokenId,
      proxmoxTokenSecretEncrypted: keepOrEncrypt(parsed.proxmoxTokenSecret, previous.proxmoxTokenSecretEncrypted),
      proxmoxVerifyTls: parsed.proxmoxVerifyTls,
      proxmoxVncUser: parsed.proxmoxVncUser,
      proxmoxVncPasswordEncrypted: keepOrEncrypt(parsed.proxmoxVncPassword, previous.proxmoxVncPasswordEncrypted),
      ramThresholdPercent: parsed.ramThresholdPercent,
      maintenanceMode: parsed.maintenanceMode,
      autoFailover: parsed.autoFailover,
      updatedBy,
    },
  })
  return publicSystemSettings(row)
}

export async function updateSystemAnalyticsSettings(input: unknown, updatedBy?: string, options: { allowCustomScripts?: boolean } = {}) {
  const parsed = analyticsSchema.parse(input)
  const previous = await currentRow()
  const canUpdateCustomScripts = Boolean(options.allowCustomScripts)
  const row = await (prisma as any).systemSetting.update({
    where: { id: previous.id },
    data: {
      googleAnalyticsId: parsed.googleAnalyticsId,
      metaPixelId: parsed.metaPixelId,
      tawkPropertyId: parsed.tawkPropertyId,
      crispWebsiteId: parsed.crispWebsiteId,
      customHeadScript: canUpdateCustomScripts ? parsed.customHeadScript : previous.customHeadScript,
      customBodyScript: canUpdateCustomScripts ? parsed.customBodyScript : previous.customBodyScript,
      analyticsUpdatedAt: new Date(),
      analyticsVersion: { increment: 1 },
      updatedBy,
    },
  })
  revalidateRuntimeConfig()
  return publicSystemSettings(row)
}
