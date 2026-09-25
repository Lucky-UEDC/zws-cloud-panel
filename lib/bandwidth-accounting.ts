import { prisma } from "@/lib/db"
import { getBillingPricingSettings } from "@/lib/settings"

export type BandwidthPeriod = "minute" | "hour" | "day" | "week" | "month" | "year" | "lifetime"
export type BandwidthScopeType = "vps" | "customer" | "node" | "product" | "ip"

const GB = 1024 ** 3
const TB = 1024 ** 4
const PERIODS: BandwidthPeriod[] = ["minute", "hour", "day", "week", "month", "year", "lifetime"]

function numberValue(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function bigintValue(value: unknown) {
  return BigInt(Math.max(0, Math.floor(numberValue(value))))
}

export function gbToBytes(gb: unknown) {
  return BigInt(Math.max(0, Math.floor(numberValue(gb) * GB)))
}

export function tbToBytes(tb: unknown) {
  return BigInt(Math.max(0, Math.floor(numberValue(tb) * TB)))
}

export function bytesToGb(bytes: unknown) {
  return numberValue(bytes) / GB
}

export function bucketStart(period: BandwidthPeriod, input = new Date()) {
  if (period === "lifetime") return new Date("1970-01-01T00:00:00.000Z")
  const date = new Date(input)
  date.setUTCSeconds(0, 0)
  if (period === "minute") return date
  date.setUTCMinutes(0, 0, 0)
  if (period === "hour") return date
  date.setUTCHours(0, 0, 0, 0)
  if (period === "day") return date
  if (period === "week") {
    const day = date.getUTCDay() || 7
    date.setUTCDate(date.getUTCDate() - day + 1)
    return date
  }
  date.setUTCDate(1)
  if (period === "month") return date
  date.setUTCMonth(0, 1)
  return date
}

export function calculateBandwidthCharge(input: {
  bytes: unknown
  includedBytes?: unknown
  pricePer10GbInr?: unknown
  highUsageThresholdGb?: unknown
  highUsageDiscountPercent?: unknown
}) {
  const totalBytes = bigintValue(input.bytes)
  const includedBytes = bigintValue(input.includedBytes)
  const billableBytes = totalBytes > includedBytes ? totalBytes - includedBytes : BigInt(0)
  const pricePer10GbInr = numberValue(input.pricePer10GbInr ?? 1)
  const thresholdBytes = gbToBytes(input.highUsageThresholdGb ?? 2048)
  const discountPercent = billableBytes > thresholdBytes ? Math.max(0, Math.min(100, numberValue(input.highUsageDiscountPercent ?? 20))) : 0
  const base = (bytesToGb(billableBytes) / 10) * pricePer10GbInr
  const estimatedInr = Number((base * (1 - discountPercent / 100)).toFixed(2))
  return { totalBytes, includedBytes, billableBytes, estimatedInr, discountPercent }
}

function scopeEntries(input: {
  vpsInstanceId: string
  customerId?: string | null
  productId?: string | null
  proxmoxNodeId?: string | null
  ipAddress?: string | null
}) {
  const entries: Array<{ scopeType: BandwidthScopeType; scopeId: string }> = [
    { scopeType: "vps", scopeId: input.vpsInstanceId },
  ]
  if (input.customerId) entries.push({ scopeType: "customer", scopeId: input.customerId })
  if (input.productId) entries.push({ scopeType: "product", scopeId: input.productId })
  if (input.proxmoxNodeId) entries.push({ scopeType: "node", scopeId: input.proxmoxNodeId })
  if (input.ipAddress) entries.push({ scopeType: "ip", scopeId: input.ipAddress })
  return entries
}

async function maybeCreateSoftLimitAlert(input: {
  vpsInstanceId: string
  customerId?: string | null
  monthlyTotalBytes: bigint
  includedBytes: bigint
  softLimitPercent: number
}) {
  if (input.includedBytes <= BigInt(0)) return
  const threshold = BigInt(Math.floor(Number(input.includedBytes) * (input.softLimitPercent / 100)))
  if (threshold <= BigInt(0) || input.monthlyTotalBytes < threshold) return
  await (prisma as any).bandwidthUsageAlert.upsert({
    where: {
      vpsInstanceId_alertType_status: {
        vpsInstanceId: input.vpsInstanceId,
        alertType: "soft_limit",
        status: "open",
      },
    },
    update: {
      currentBytes: input.monthlyTotalBytes,
      thresholdBytes: threshold,
      lastSeenAt: new Date(),
      message: `Bandwidth usage reached ${input.softLimitPercent}% of included quota.`,
    },
    create: {
      vpsInstanceId: input.vpsInstanceId,
      customerId: input.customerId || null,
      alertType: "soft_limit",
      thresholdBytes: threshold,
      currentBytes: input.monthlyTotalBytes,
      message: `Bandwidth usage reached ${input.softLimitPercent}% of included quota.`,
      metadata: { policy: "alert_then_overage" },
    },
  }).catch(() => null)
}

export async function recordBandwidthSample(input: {
  vpsInstanceId: string
  customerId?: string | null
  productId?: string | null
  proxmoxNodeId?: string | null
  ipAddress?: string | null
  vmid?: number | null
  rxBytes: unknown
  txBytes: unknown
  rxRateBps?: unknown
  txRateBps?: unknown
  recordedAt?: Date
  includedBandwidthTb?: unknown
  metadata?: Record<string, unknown>
}) {
  const settings = await getBillingPricingSettings().catch(() => ({
    bandwidthPricePer10GbInr: 1,
    bandwidthHighUsageThresholdGb: 2048,
    bandwidthHighUsageDiscountPercent: 20,
    bandwidthSoftLimitPercent: 80,
  }))
  const recordedAt = input.recordedAt || new Date()
  const rxBytes = bigintValue(input.rxBytes)
  const txBytes = bigintValue(input.txBytes)
  const totalBytes = rxBytes + txBytes
  const rxRateBps = bigintValue(input.rxRateBps)
  const txRateBps = bigintValue(input.txRateBps)
  const peakRateBps = rxRateBps > txRateBps ? rxRateBps : txRateBps
  const includedBytes = tbToBytes(input.includedBandwidthTb || 0)

  const sample = await (prisma as any).bandwidthUsageSample.create({
    data: {
      vpsInstanceId: input.vpsInstanceId,
      customerId: input.customerId || null,
      productId: input.productId || null,
      proxmoxNodeId: input.proxmoxNodeId || null,
      ipAddress: input.ipAddress || null,
      vmid: input.vmid || null,
      rxBytes,
      txBytes,
      totalBytes,
      rxRateBps,
      txRateBps,
      peakRateBps,
      source: "proxmox",
      recordedAt,
      metadata: input.metadata || {},
    },
  })

  let monthlyVpsRollup: any = null
  for (const { scopeType, scopeId } of scopeEntries(input)) {
    for (const period of PERIODS) {
      const bucketAt = bucketStart(period, recordedAt)
      const charge = calculateBandwidthCharge({
        bytes: totalBytes,
        includedBytes: scopeType === "vps" || scopeType === "customer" ? includedBytes : 0,
        pricePer10GbInr: settings.bandwidthPricePer10GbInr,
        highUsageThresholdGb: settings.bandwidthHighUsageThresholdGb,
        highUsageDiscountPercent: settings.bandwidthHighUsageDiscountPercent,
      })
      const updated = await (prisma as any).bandwidthUsageRollup.upsert({
        where: { scopeType_scopeId_period_bucketAt: { scopeType, scopeId, period, bucketAt } },
        update: {
          rxBytes: { increment: rxBytes },
          txBytes: { increment: txBytes },
          totalBytes: { increment: totalBytes },
          peakRateBps,
          samples: { increment: 1 },
          includedBytes: charge.includedBytes,
          billableBytes: { increment: charge.billableBytes },
          estimatedInr: { increment: charge.estimatedInr },
          discountPercent: charge.discountPercent,
        },
        create: {
          scopeType,
          scopeId,
          vpsInstanceId: scopeType === "vps" ? input.vpsInstanceId : null,
          customerId: input.customerId || null,
          productId: input.productId || null,
          proxmoxNodeId: input.proxmoxNodeId || null,
          ipAddress: input.ipAddress || null,
          period,
          bucketAt,
          rxBytes,
          txBytes,
          totalBytes,
          avgRateBps: peakRateBps,
          peakRateBps,
          samples: 1,
          includedBytes: charge.includedBytes,
          billableBytes: charge.billableBytes,
          estimatedInr: charge.estimatedInr,
          discountPercent: charge.discountPercent,
        },
      })
      if (scopeType === "vps" && period === "month") monthlyVpsRollup = updated
    }
  }

  if (monthlyVpsRollup) {
    await maybeCreateSoftLimitAlert({
      vpsInstanceId: input.vpsInstanceId,
      customerId: input.customerId || null,
      monthlyTotalBytes: BigInt(monthlyVpsRollup.totalBytes || 0),
      includedBytes,
      softLimitPercent: numberValue(settings.bandwidthSoftLimitPercent || 80),
    })
  }

  return sample
}

export async function getBandwidthSummary(input: {
  scopeType: BandwidthScopeType
  scopeId: string
  period?: BandwidthPeriod
  from?: Date
  to?: Date
  includedBandwidthTb?: unknown
}) {
  const period = input.period || "month"
  const from = input.from || bucketStart(period)
  const to = input.to || new Date()
  const settings = await getBillingPricingSettings()
  const rows = await (prisma as any).bandwidthUsageRollup.findMany({
    where: {
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      period,
      bucketAt: { gte: from, lte: to },
    },
    orderBy: { bucketAt: "asc" },
  }).catch(() => [])
  const totalBytes = rows.reduce((sum: bigint, row: any) => sum + BigInt(row.totalBytes || 0), BigInt(0))
  const rxBytes = rows.reduce((sum: bigint, row: any) => sum + BigInt(row.rxBytes || 0), BigInt(0))
  const txBytes = rows.reduce((sum: bigint, row: any) => sum + BigInt(row.txBytes || 0), BigInt(0))
  const peakRateBps = rows.reduce((max: bigint, row: any) => {
    const value = BigInt(row.peakRateBps || 0)
    return value > max ? value : max
  }, BigInt(0))
  const charge = calculateBandwidthCharge({
    bytes: totalBytes,
    includedBytes: tbToBytes(input.includedBandwidthTb || 0),
    pricePer10GbInr: settings.bandwidthPricePer10GbInr,
    highUsageThresholdGb: settings.bandwidthHighUsageThresholdGb,
    highUsageDiscountPercent: settings.bandwidthHighUsageDiscountPercent,
  })
  return {
    period,
    from: from.toISOString(),
    to: to.toISOString(),
    rxBytes: Number(rxBytes),
    txBytes: Number(txBytes),
    totalBytes: Number(totalBytes),
    peakRateBps: Number(peakRateBps),
    includedBytes: Number(charge.includedBytes),
    billableBytes: Number(charge.billableBytes),
    estimatedInr: charge.estimatedInr,
    discountPercent: charge.discountPercent,
    rows: rows.map((row: any) => ({
      bucketAt: row.bucketAt?.toISOString ? row.bucketAt.toISOString() : row.bucketAt,
      rxBytes: Number(row.rxBytes || 0),
      txBytes: Number(row.txBytes || 0),
      totalBytes: Number(row.totalBytes || 0),
      peakRateBps: Number(row.peakRateBps || 0),
      estimatedInr: Number(row.estimatedInr || 0),
      discountPercent: Number(row.discountPercent || 0),
    })),
  }
}
