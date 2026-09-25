import { refreshExchangeRateCache } from "@/lib/exchange-rates"

const INTERVAL_MS = 30 * 60 * 1000

async function tick() {
  const result = await refreshExchangeRateCache()
  console.log("[EXCHANGE_RATE_REFRESH] scheduler tick complete", result)
}

async function main() {
  const once = process.argv.includes("--once")
  await tick().catch((error) => {
    console.error("[EXCHANGE_RATE_REFRESH] scheduler tick failed", error)
    process.exitCode = 1
  })
  if (once) return
  setInterval(() => {
    tick().catch((error) => console.error("[EXCHANGE_RATE_REFRESH] scheduler tick failed", error))
  }, INTERVAL_MS)
}

main()
