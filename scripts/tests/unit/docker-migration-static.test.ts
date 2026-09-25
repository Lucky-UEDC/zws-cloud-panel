import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function read(path: string) {
  return readFileSync(path, "utf8")
}

test("Docker entrypoint exposes required commands and strict startup gates", () => {
  const entrypoint = read("docker-entrypoint.sh")
  for (const command of ["migrate", "app", "worker", "scheduler", "backup", "self-test"]) {
    assert.match(entrypoint, new RegExp(`${command}\\)`))
  }
  assert.match(entrypoint, /prisma migrate deploy/)
  assert.match(entrypoint, /scripts\/validate-migrations\.ts/)
  assert.match(entrypoint, /scripts\/docker-strict-integrations\.ts/)
  assert.match(entrypoint, /pg_isready/)
  assert.match(entrypoint, /redis-cli/)
})

test("Compose defines app worker scheduler backup redis nginx db tunnel and optional postgres", () => {
  const compose = read("docker-compose.yml")
  for (const service of ["app:", "worker:", "scheduler:", "backup:", "redis:", "nginx:", "postgres:", "migrate:", "self-test:", "db-tunnel:", "host-db-proxy:", "host-redis-proxy:"]) {
    assert.match(compose, new RegExp(`\\n  ${service}`))
  }
  assert.match(compose, /profiles: \["local-db"\]/)
  assert.match(compose, /profiles: \["db-tunnel"\]/)
  assert.match(compose, /db\.myrdphub\.com/)
  assert.match(compose, /service_completed_successfully/)
  assert.doesNotMatch(compose, /^version:/m)
})

test("WhatsApp remains Evolution-only with no whatsapp-web runtime dependency", () => {
  const pkg = read("package.json")
  const strict = read("scripts/docker-strict-integrations.ts")
  const evolution = read("lib/whatsapp/evolution.ts")
  assert.doesNotMatch(pkg, /whatsapp-web\.js|wwebjs/)
  assert.match(strict, /testEvolutionConnection/)
  assert.match(evolution, /provider: "evolution"/)
  assert.doesNotMatch(pkg, /whatsapp-web\.js|wwebjs/)
})

test("Docker process supervisors assign queue consumers and schedules exactly once", () => {
  const worker = read("workers/zws-worker.ts")
  const scheduler = read("workers/zws-scheduler.ts")
  assert.match(worker, /scripts\/whatsapp-worker\.ts/)
  assert.match(worker, /scripts\/proxmox-event-watcher\.ts/)
  for (const script of ["renewal-worker", "backup-scheduler", "exchange-rate-scheduler", "cleanup-unpaid-invoices"]) {
    assert.doesNotMatch(worker, new RegExp(`scripts/${script}\\.ts`))
    assert.match(scheduler, new RegExp(`scripts/${script}\\.ts`))
  }
})

test("Database registry and self-test are part of Docker startup contract", () => {
  const entrypoint = read("docker-entrypoint.sh")
  const schema = read("prisma/schema.prisma")
  const selfTest = read("scripts/docker-self-test.ts")
  assert.match(entrypoint, /scripts\/database-registry\.ts seed-defaults/)
  assert.match(entrypoint, /scripts\/database-registry\.ts validate/)
  assert.match(schema, /model DatabaseRegistry/)
  assert.match(schema, /model TenantDatabaseMapping/)
  for (const route of ["/login", "/dashboard", "/admin", "/customers", "/orders", "/vms", "/nodes", "/networking", "/billing", "/whatsapp", "/settings"]) {
    assert.match(selfTest, new RegExp(route.replace("/", "\\/")))
  }
  assert.match(selfTest, /SELF_TEST_PROXMOX_LIFECYCLE/)
  assert.match(selfTest, /SELF_TEST_REALTIME_MAX_MS/)
  assert.match(selfTest, /host\\\.docker\\\.internal/)
  assert.match(selfTest, /redirect: "manual"/)
  assert.match(selfTest, /checks: result\.checks\.map/)
  assert.doesNotMatch(selfTest, /\["WhatsApp Evolution", \(\) => testEvolutionConnection\(\)\]/)
})
