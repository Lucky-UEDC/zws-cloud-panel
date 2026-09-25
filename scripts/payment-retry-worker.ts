import "dotenv/config"
import { prisma } from "@/lib/db"
import { processPaymentRetryBatch } from "@/lib/payments/retry-manager"

const once = process.argv.includes("--once")
async function main() { do { const results = await processPaymentRetryBatch(50); console.log("[PaymentRetryWorker] tick", { processed: results.length }); if (once) break; await new Promise((resolve) => setTimeout(resolve, results.length ? 1000 : 15_000)) } while (true) }
main().catch((error) => { console.error("[PaymentRetryWorker] fatal", { message: error instanceof Error ? error.message : String(error) }); process.exitCode = 1 }).finally(async () => { if (once) await prisma.$disconnect().catch(() => undefined) })
