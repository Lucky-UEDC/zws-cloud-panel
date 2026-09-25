import { assertCurrencyCode } from "@/lib/pricing-catalog"

export type ExchangeRateSnapshot = {
  provider: "inr-only"
  base: "INR"
  rates: { INR: 1 }
  currencies: { INR: "Indian Rupee" }
  fetchedAt: string
  timestamp?: number | null
  source: "origin"
  stale: false
}

function inrSnapshot(): ExchangeRateSnapshot {
  return {
    provider: "inr-only",
    base: "INR",
    rates: { INR: 1 },
    currencies: { INR: "Indian Rupee" },
    fetchedAt: new Date().toISOString(),
    timestamp: null,
    source: "origin",
    stale: false,
  }
}

export async function getOpenExchangeRatesSnapshot(_options: { force?: boolean } = {}) {
  return inrSnapshot()
}

export async function refreshInrRateCacheFromSnapshot(_snapshot: Pick<ExchangeRateSnapshot, "rates">) {
  return { refreshed: 1 }
}

export async function refreshExchangeRateCache() {
  return refreshInrRateCacheFromSnapshot(inrSnapshot())
}

export async function getInrExchangeRate(targetCurrency: string) {
  assertCurrencyCode(targetCurrency)
  return {
    rate: 1,
    source: "origin" as const,
    fetchedAt: new Date().toISOString(),
    stale: false,
    currencyName: "Indian Rupee",
  }
}

export async function exchangeRatesHealth() {
  const snapshot = inrSnapshot()
  return {
    ok: true,
    configured: true,
    provider: snapshot.provider,
    base: snapshot.base,
    fetchedAt: snapshot.fetchedAt,
    source: snapshot.source,
    stale: snapshot.stale,
    symbols: 1,
  }
}
