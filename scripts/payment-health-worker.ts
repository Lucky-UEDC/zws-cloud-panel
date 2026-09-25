import "dotenv/config"
import { runPaymentGatewayHealthCheck } from "@/lib/payments/gateway-health"

const once = process.argv.includes("--once")
const intervalMs = Math.max(60_000, Number(process.env.PAYMENT_HEALTH_INTERVAL_MS || 5 * 60_000))

async function tick() {
  const result = await runPaymentGatewayHealthCheck()
  console.log("[PaymentHealthWorker] tick", result)
}

async function main() {
  console.log("[PaymentHealthWorker] started", { once, intervalMs })
  do {
    try {
      await tick()
    } catch (error: any) {
      console.error("[PaymentHealthWorker] tick failed", { message: error?.message || String(error) })
    }
    if (once) break
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  } while (true)
}

main().catch((error) => {
  console.error("[PaymentHealthWorker] fatal", error)
  process.exitCode = 1
})
