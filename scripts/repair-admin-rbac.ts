import "dotenv/config"
import { prisma } from "@/lib/db"
import { revokeSessionsForUser } from "@/lib/auth/session-store"
import { getRedisClient } from "@/lib/redis"

async function main() {
  const email = process.env.ADMIN_EMAIL || "admin@example.com"
  const admin = await prisma.adminProfile.findUnique({ where: { email } })
  if (!admin) {
    console.log(`Admin account not found: ${email}`)
    return
  }

  const updated = await prisma.adminProfile.update({
    where: { id: admin.id },
    data: { role: "super_admin", isActive: true },
    select: { id: true, email: true, role: true, isActive: true },
  })

  await revokeSessionsForUser(updated.id)
  console.log(JSON.stringify({ repaired: true, admin: updated, sessionsRevoked: true }, null, 2))
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    await getRedisClient()?.quit().catch(() => undefined)
  })
