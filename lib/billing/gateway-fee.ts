import { prisma } from "@/lib/db"
import { getCreditSettings, type CreditSettings } from "@/lib/settings"
import { add, money, round2, mulAmount } from "@/lib/billing/money"

export type GatewayFeeConfigResult = {
  gateway: string
  feePercent: number
  fixedFee: number
  minAmount: number | null
  maxAmount: number | null
  configured: boolean
}

export function normalizeGateway(gateway: string | null | undefined): string {
  return String(gateway || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "") || "generic"
}

export type BillingGatewayFeeSettings = {
  feePercent: number
  fixedFee: number
}

export function creditFeeSettingsForGateway(settings: CreditSettings | null | undefined, gateway: string | null | undefined): BillingGatewayFeeSettings {
  const gw = normalizeGateway(gateway)
  if (gw === "wallet") return { feePercent: 0, fixedFee: 0 }
  if (!settings?.enabled) return { feePercent: 3, fixedFee: 0 }
  if (gw === "razorpay") return { feePercent: Number(settings.razorpayFeePercent ?? 3), fixedFee: Number(settings.razorpayFixedFee ?? 0) }
  if (gw === "cashfree") return { feePercent: Number(settings.cashfreeFeePercent ?? 3), fixedFee: Number(settings.cashfreeFixedFee ?? 0) }
  if (gw === "phonepe") return { feePercent: Number(settings.phonepeFeePercent ?? 0), fixedFee: Number(settings.phonepeFixedFee ?? 0) }
  return { feePercent: Number(settings.razorpayFeePercent ?? 3), fixedFee: Number(settings.razorpayFixedFee ?? 0) }
}

export async function resolveGatewayFeeConfig(gateway: string | null | undefined): Promise<GatewayFeeConfigResult> {
  const gw = normalizeGateway(gateway)
  const rawGateway = String(gateway || "").trim()
  const row = rawGateway
    ? await prisma.gatewayFeeConfig.findUnique({ where: { gateway: rawGateway } }).catch(() => null)
    : null
  if (row?.enabled) {
    return {
      gateway: rawGateway,
      feePercent: money(row.feePercent),
      fixedFee: money(row.fixedFee),
      minAmount: row.minAmount != null ? money(row.minAmount) : null,
      maxAmount: row.maxAmount != null ? money(row.maxAmount) : null,
      configured: true,
    }
  }
  const settings = await getCreditSettings().catch(() => null)
  const next = creditFeeSettingsForGateway(settings, gateway)
  return { gateway: gw, ...next, minAmount: null, maxAmount: null, configured: false }
}

export type GatewayFeeResult = {
  gateway: string
  grossAmount: number
  feePercent: number
  fixedFee: number
  feeAmount: number
  netAmount: number
  configured: boolean
}

export async function computeGatewayFee(input: {
  gateway?: string | null
  grossAmount: number
  creditEnabled?: boolean
}): Promise<GatewayFeeResult> {
  const gross = round2(input.grossAmount || 0)
  const gw = normalizeGateway(input.gateway)
  const settings = await getCreditSettings().catch(() => null)
  const creditEnabled = input.creditEnabled ?? settings?.enabled ?? true
  if (!creditEnabled || gw === "wallet") {
    return { gateway: gw, grossAmount: gross, feePercent: 0, fixedFee: 0, feeAmount: 0, netAmount: gross, configured: false }
  }
  const config = await resolveGatewayFeeConfig(gw)
  const withinBounds = (config.minAmount == null || gross >= config.minAmount) && (config.maxAmount == null || gross <= config.maxAmount)
  if (!withinBounds) {
    return { gateway: gw, grossAmount: gross, feePercent: 0, fixedFee: 0, feeAmount: 0, netAmount: gross, configured: false }
  }
  const feeAmount = round2(add(mulAmount(gross, (config.feePercent || 0) / 100), config.fixedFee || 0))
  const netAmount = round2(gross - feeAmount)
  return {
    gateway: gw,
    grossAmount: gross,
    feePercent: config.feePercent,
    fixedFee: config.fixedFee,
    feeAmount,
    netAmount,
    configured: true,
  }
}

export async function resolveTopupLimits(input?: {
  billingMinimum?: number
}): Promise<{ minTopup: number; maxTopup: number }> {
  const settings = await getCreditSettings().catch(() => null)
  const settingsMin = Number(settings?.minTopupAmount ?? 0)
  const settingsMax = Number(settings?.maxTopupAmount ?? 0)
  const billingMin = Number(input?.billingMinimum ?? 0)
  const minTopup = settingsMin > 0 ? settingsMin : billingMin > 0 ? billingMin : 10
  const maxTopup = settingsMax > 0 ? settingsMax : 0
  return { minTopup, maxTopup }
}