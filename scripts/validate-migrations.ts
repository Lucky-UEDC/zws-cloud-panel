import { readdir } from "node:fs/promises"
import { resolve } from "node:path"
import { prisma } from "@/lib/db"

const ALLOWED_DATABASE_ONLY_MIGRATIONS = new Set([
  "20260618_database_first_vm_platform",
  "20260618_exact_ip_assignment_history_tables",
  "20260618_vm_network_cache_canonical",
  "20260619_vm_status_metrics_disk_ip_hostname",
  "20260808000000_fresh_full_baseline",
])

async function main() {
  const migrationDir = resolve(process.cwd(), "prisma", "migrations")
  const entries = await readdir(migrationDir, { withFileTypes: true })
  const localMigrations = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()

  const failedRows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
    SELECT migration_name
    FROM "_prisma_migrations"
    WHERE finished_at IS NULL AND rolled_back_at IS NULL
  `.catch(() => [])

  const appliedRows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
    SELECT migration_name
    FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
  `.catch(() => [])

  const failedMigrations = failedRows.map((row) => String(row.migration_name)).filter(Boolean)
  const applied = new Set(appliedRows.map((row) => String(row.migration_name)))
  const pendingMigrations = localMigrations.filter((name) => !applied.has(name))
  const databaseOnlyMigrations = Array.from(applied).filter((name) => !localMigrations.includes(name)).sort()
  const unexpectedDatabaseOnlyMigrations = databaseOnlyMigrations.filter(
    (name) => !ALLOWED_DATABASE_ONLY_MIGRATIONS.has(name),
  )

  if (failedMigrations.length || pendingMigrations.length || unexpectedDatabaseOnlyMigrations.length) {
    console.error("[MigrationValidation] FAILED")
    if (failedMigrations.length) {
      console.error(`[MigrationValidation] Failed/incomplete migrations: ${failedMigrations.join(", ")}`)
    }
    if (pendingMigrations.length) {
      console.error(`[MigrationValidation] Pending deployment migrations: ${pendingMigrations.join(", ")}`)
    }
    if (unexpectedDatabaseOnlyMigrations.length) {
      console.error(
        `[MigrationValidation] Unexpected database-only migrations: ${unexpectedDatabaseOnlyMigrations.join(", ")}`,
      )
    }
    process.exit(1)
  }

  if (databaseOnlyMigrations.length) {
    console.log(`[MigrationValidation] Approved database-only migrations: ${databaseOnlyMigrations.join(", ")}`)
  }
  console.log("[MigrationValidation] OK")
}

main()
  .catch((error) => {
    console.error("[MigrationValidation] FAILED")
    console.error(error?.message || String(error))
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
