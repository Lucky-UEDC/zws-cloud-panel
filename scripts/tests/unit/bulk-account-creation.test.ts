import { readFileSync } from "node:fs"
import { test } from "node:test"
import assert from "node:assert/strict"

function read(path: string) {
  return readFileSync(path, "utf8")
}

test("bulk create API exists at correct path", () => {
  const src = read("app/api/admin/customers/bulk-create/route.ts")
  assert.match(src, /export async function POST/)
})

test("bulk create enforces MAX_BULK_COUNT of 5000", () => {
  const src = read("app/api/admin/customers/bulk-create/route.ts")
  assert.match(src, /MAX_BULK_COUNT\s*=\s*5000/)
  assert.match(src, /count > MAX_BULK_COUNT|count.*MAX_BULK_COUNT/)
})

test("bulk create uses pre-hash-once pattern", () => {
  const src = read("app/api/admin/customers/bulk-create/route.ts")
  assert.match(src, /bcrypt\.hash\(defaultPassword/)
  assert.match(src, /sharedHash/)
  const hashCalls = src.match(/bcrypt\.hash\(/g) || []
  assert.equal(hashCalls.length, 1, "bcrypt.hash must be called exactly once (pre-hash pattern)")
})

test("bulk create processes in batches of 50", () => {
  const src = read("app/api/admin/customers/bulk-create/route.ts")
  assert.match(src, /BATCH_SIZE\s*=\s*50/)
  assert.match(src, /batchStart.*BATCH_SIZE|BATCH_SIZE.*batchStart/)
})

test("bulk create validates email prefix format", () => {
  const src = read("app/api/admin/customers/bulk-create/route.ts")
  assert.match(src, /emailPrefix.*[a-z0-9]|[a-z0-9].*emailPrefix/)
  assert.match(src, /400/)
})

test("bulk create validates password minimum length", () => {
  const src = read("app/api/admin/customers/bulk-create/route.ts")
  assert.match(src, /\.length < 12/)
  assert.match(src, /400/)
})

test("bulk create uses admin auth guard", () => {
  const src = read("app/api/admin/customers/bulk-create/route.ts")
  assert.match(src, /getAdminFromCookies/)
  assert.match(src, /isAdminLikeRole/)
  assert.match(src, /401/)
})

test("bulk create UI page has count options", () => {
  const src = read("app/admin/customers/bulk/page.tsx")
  assert.match(src, /COUNT_OPTIONS/)
  assert.match(src, /100/)
  assert.match(src, /500/)
  assert.match(src, /1000/)
  assert.match(src, /5000/)
})

test("bulk create UI has dry run toggle", () => {
  const src = read("app/admin/customers/bulk/page.tsx")
  assert.match(src, /dryRun/)
  assert.match(src, /Dry Run/)
})

test("bulk create returns correct response shape", () => {
  const src = read("app/api/admin/customers/bulk-create/route.ts")
  assert.match(src, /created/)
  assert.match(src, /failed/)
  assert.match(src, /skipped/)
  assert.match(src, /startIndex/)
})

test("bulk create uses collision-safe index from existing count", () => {
  const src = read("app/api/admin/customers/bulk-create/route.ts")
  assert.match(src, /prisma\.customer\.count/)
  assert.match(src, /startIndex\s*=\s*existingCount\s*\+\s*1/)
})

test("bulk create writes audit log", () => {
  const src = read("app/api/admin/customers/bulk-create/route.ts")
  assert.match(src, /createPanelLog/)
  assert.match(src, /bulk_account_creation/)
})
