const DECIMAL_UNITS = ["B", "KB", "MB", "GB", "TB"] as const
const DECIMAL = 1000

type FormatOptions = {
  fallback?: string
  maximumFractionDigits?: number
  minimumFractionDigits?: number
  locale?: string
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatNumber(value: number, options: FormatOptions = {}) {
  return value.toLocaleString(options.locale || "en-IN", {
    maximumFractionDigits: options.maximumFractionDigits ?? 1,
    minimumFractionDigits: options.minimumFractionDigits,
  })
}

export function bytesToDecimalGb(value: unknown) {
  const bytes = numberValue(value)
  return bytes > 0 ? bytes / DECIMAL ** 3 : 0
}

export function gbToBytesDecimal(value: unknown) {
  const gb = numberValue(value)
  return gb > 0 ? gb * DECIMAL ** 3 : 0
}

export function formatBytesDecimal(value: unknown, options: FormatOptions = {}) {
  const bytes = numberValue(value)
  const fallback = options.fallback ?? "0 B"
  if (bytes <= 0) return fallback
  const index = Math.min(DECIMAL_UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(DECIMAL)))
  return `${formatNumber(bytes / DECIMAL ** index, options)} ${DECIMAL_UNITS[index]}`
}

export function formatRamGbFromBytes(value: unknown, fallback = "0 GB") {
  const bytes = numberValue(value)
  if (bytes <= 0) return fallback
  const gb = bytes / 1024 ** 3
  const rounded = Math.abs(gb - Math.round(gb)) < 0.05 ? Math.round(gb) : gb
  return `${formatNumber(rounded, { maximumFractionDigits: rounded >= 10 ? 0 : 1 })} GB`
}

export function formatGbDecimal(value: unknown, fallback = "Usage unavailable") {
  const gb = numberValue(value)
  return gb > 0 ? `${formatNumber(gb, { maximumFractionDigits: gb >= 100 ? 0 : 1 })} GB` : fallback
}

export function formatPercent(value: unknown, maximumFractionDigits = 1) {
  const parsed = Math.max(0, Math.min(100, numberValue(value)))
  return `${formatNumber(parsed, { maximumFractionDigits })}%`
}

export function formatRateDecimal(bytesPerSecond: unknown, options: FormatOptions = {}) {
  const bps = Math.max(0, numberValue(bytesPerSecond) * 8)
  if (bps <= 0) return options.fallback ?? "0 Kbps"
  if (bps >= 1000 ** 3) return `${formatNumber(bps / 1000 ** 3, options)} Gbps`
  if (bps >= 1000 ** 2) return `${formatNumber(bps / 1000 ** 2, options)} Mbps`
  return `${formatNumber(Math.max(0.1, bps / 1000), options)} Kbps`
}

export function formatByteRateDecimal(bytesPerSecond: unknown, options: FormatOptions = {}) {
  return `${formatBytesDecimal(bytesPerSecond, { fallback: options.fallback ?? "0 B", ...options })}/s`
}

export function deriveCounterRates<T extends { recordedAt: string }>(
  rows: T[],
  keys: Array<keyof T>,
) {
  return rows.map((row, index) => {
    const previous = rows[index - 1]
    const seconds = previous
      ? Math.max(1, (new Date(row.recordedAt).getTime() - new Date(previous.recordedAt).getTime()) / 1000)
      : 1
    const rates: Record<string, number> = {}
    for (const key of keys) {
      const currentValue = numberValue(row[key])
      const previousValue = previous ? numberValue(previous[key]) : currentValue
      rates[`${String(key)}Rate`] = Math.max(0, Math.round((currentValue - previousValue) / seconds))
    }
    return { ...row, ...rates }
  })
}
