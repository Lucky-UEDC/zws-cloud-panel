import "dotenv/config"
import { prisma } from "@/lib/db"
import { releaseExpiredCheckoutReservations } from "@/lib/checkout-reservations"

async function main() {
  const result = await releaseExpiredCheckoutReservations()
  console.log("[checkout-reservation-cleanup]", result)
}

main()
  .catch((error) => {
    console.error("[checkout-reservation-cleanup] failed", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
    process.exit(process.exitCode || 0)
  })
