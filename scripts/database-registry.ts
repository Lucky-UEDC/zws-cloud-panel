import "dotenv/config"
import { prisma } from "@/lib/db"
import { seedDefaultDatabaseRegistry } from "@/lib/database-registry"
import { disconnectManagedDatabaseClients } from "@/lib/db-manager"

async function main() {
  const command = process.argv[2] || "seed-defaults"
  if (command !== "seed-defaults" && command !== "validate") {
    throw new Error(`Unsupported database registry command: ${command}`)
  }

  if (command === "seed-defaults") {
    const rows = await seedDefaultDatabaseRegistry()
    console.log("[database-registry] seeded", rows.map((row: any) => ({ key: row.key, purpose: row.purpose, databaseName: row.databaseName })))
  }

  const required = ["main", "staging", "test"]
  const rows = await (prisma as any).databaseRegistry.findMany({ where: { key: { in: required } } })
  const found = new Set(rows.map((row: any) => row.key))
  const missing = required.filter((key) => !found.has(key))
  if (missing.length) throw new Error(`Missing database registry entries: ${missing.join(", ")}`)
  console.log("[database-registry] validation passed")
}

main()
  .catch((error) => {
    console.error("[database-registry]", error?.message || String(error))
    process.exit(1)
  })
  .finally(async () => {
    await disconnectManagedDatabaseClients()
    await prisma.$disconnect().catch(() => undefined)
  })
