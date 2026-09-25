import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

function read(path: string) {
  return readFileSync(path, "utf8")
}

test("VM add-on advisory locks execute without deserializing PostgreSQL void", () => {
  const source = read("lib/vm-addons.ts")
  const helper = source.slice(
    source.indexOf("async function acquireAddonPurchaseDbLock"),
    source.indexOf("export async function listAvailableVmAddons"),
  )

  assert.match(helper, /typeof tx\?\.\$executeRaw !== "function"/)
  assert.match(helper, /tx\.\$executeRaw`SELECT pg_advisory_xact_lock\(hashtext\(\$\{scope\}\)\)`/)
  assert.doesNotMatch(helper, /\$queryRaw/)
  assert.doesNotMatch(helper, /\$executeRawUnsafe/)
  assert.doesNotMatch(helper, /\.catch\(/)
})

test("database repair checks use Prisma SQL values and cast regclass results", () => {
  const source = read("lib/database-repair-engine.ts")
  const regclassQueries = source.match(/to_regclass\([^\n]+/g) || []

  assert.match(source, /Prisma\.sql`select to_regclass/)
  assert.match(source, /prisma\.\$queryRaw<any\[]>\(check\.sql\)/)
  assert.match(source, /prisma\.\$executeRaw\(check\.repair\)/)
  assert.doesNotMatch(source, /\$queryRawUnsafe|\$executeRawUnsafe/)
  assert.equal(regclassQueries.length, 2)
  for (const query of regclassQueries) assert.match(query, /\)::text as exists/)
})
