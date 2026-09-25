function formatNumber(value: number, maximumFractionDigits = 2) {
  if (!Number.isFinite(value)) return "0"
  return value.toLocaleString("en-IN", { maximumFractionDigits })
}

export function formatBandwidthQuota(valueTb: unknown, options: { suffix?: string } = {}) {
  const tb = Number(valueTb || 0)
  const suffix = options.suffix ? ` ${options.suffix}` : ""
  if (!Number.isFinite(tb) || tb <= 0) return `0 GB${suffix}`
  if (tb < 1) return `${Math.round(tb * 1024).toLocaleString("en-IN")} GB${suffix}`
  return `${formatNumber(tb, Number.isInteger(tb) ? 0 : 2)} TB${suffix}`
}

