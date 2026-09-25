const healthUrl = process.env.HEALTH_URL || `http://127.0.0.1:${process.env.PORT || "3000"}/api/health`
const intervalMs = Number(process.env.HEALTH_WATCHDOG_INTERVAL_MS || 30_000)

export {}

async function tick() {
  const response = await fetch(healthUrl, { cache: "no-store" })
  if (!response.ok) throw new Error(`health returned ${response.status}`)
  console.log("[health-watchdog] healthy", { healthUrl, checkedAt: new Date().toISOString() })
}

await tick().catch((error) => {
  console.error("[health-watchdog] failed", error?.message || error)
  process.exitCode = 1
})

if (!process.argv.includes("--once")) {
  setInterval(() => tick().catch((error) => console.error("[health-watchdog] failed", error?.message || error)), intervalMs)
}
