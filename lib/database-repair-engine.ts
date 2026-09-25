import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"

const ADDITIVE_CHECKS = [
  {
    key: "notification_ledger_table",
    sql: Prisma.sql`select to_regclass('public.notification_ledger')::text as exists`,
    ok: (rows: any[]) => Boolean(rows?.[0]?.exists),
    repair: null,
  },
  {
    key: "checkout_reservation_columns",
    sql: Prisma.sql`select count(*)::int as count from information_schema.columns where table_name = 'checkout_sessions' and column_name in ('reserved_at','reservation_expires_at','reservation_released_at')`,
    ok: (rows: any[]) => Number(rows?.[0]?.count || 0) === 3,
    repair: Prisma.sql`ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "reserved_at" TIMESTAMP(3), ADD COLUMN IF NOT EXISTS "reservation_expires_at" TIMESTAMP(3), ADD COLUMN IF NOT EXISTS "reservation_released_at" TIMESTAMP(3)`,
  },
  {
    key: "notification_ledger_hash_index",
    sql: Prisma.sql`select to_regclass('public.notification_ledger_message_hash_key')::text as exists`,
    ok: (rows: any[]) => Boolean(rows?.[0]?.exists),
    repair: Prisma.sql`CREATE UNIQUE INDEX IF NOT EXISTS "notification_ledger_message_hash_key" ON "notification_ledger"("message_hash")`,
  },
]

export async function runDatabaseRepairEngine(options: { apply?: boolean } = {}) {
  const checks = []
  for (const check of ADDITIVE_CHECKS) {
    const rows = await prisma.$queryRaw<any[]>(check.sql).catch((error: any) => [{ error: error?.message || String(error) }])
    const ok = !("error" in (rows?.[0] || {})) && check.ok(rows)
    let repaired = false
    if (!ok && options.apply && check.repair) {
      await prisma.$executeRaw(check.repair)
      repaired = true
    }
    checks.push({ key: check.key, ok: repaired ? true : ok, repaired, destructive: false, error: rows?.[0]?.error || null })
  }
  return {
    ok: checks.every((check) => check.ok),
    applied: Boolean(options.apply),
    checks,
    destructiveRepairsBlocked: true,
  }
}
