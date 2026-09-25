import assert from "node:assert/strict"
import { readFileSync, statSync } from "node:fs"
import test from "node:test"

function read(path: string) {
  return readFileSync(path, "utf8")
}

test("database server automation installs postgres 17, WAL archiving, backups, and tunnel template", () => {
  const script = read("ops/aws-db-server-setup.sh")
  assert.match(script, /postgresql-17/)
  assert.match(script, /pgbouncer/)
  assert.match(script, /pgbackrest/)
  assert.match(script, /archive_command = 'pgbackrest --stanza=zws archive-push %p'/)
  assert.match(script, /zwscloud zwscloud_staging zwscloud_test/)
  assert.match(script, /zws-pg-backup/)
  assert.match(script, /zws-pg-restore-test/)
  assert.match(script, /zws-pgbackrest-restore-validate/)
  assert.match(script, /tcp:\/\/127\.0\.0\.1:\$\{ZWS_PGBOUNCER_PORT\}/)
  assert.match(script, /ufw deny 5432\/tcp/)
})

test("app server automation exposes tunneled database on 127.0.0.1:15432", () => {
  const script = read("ops/aws-app-db-tunnel.sh")
  assert.match(script, /cloudflared access tcp/)
  assert.match(script, /db\.myrdphub\.com/)
  assert.match(script, /TUNNEL_SERVICE_TOKEN_ID/)
  assert.match(script, /TUNNEL_SERVICE_TOKEN_SECRET/)
  assert.match(script, /15432/)
  assert.match(script, /zws-db-access\.service/)
})

test("surviving docs capture deployment and architecture notes", () => {
  const agents = read("AGENTS.md")
  const memory = read("MEMORY.md")
  assert.match(agents, /Deployment Process/)
  assert.match(agents, /Evolution API Setup/)
  assert.match(agents, /Database Architecture/)
  assert.match(agents, /Backup Architecture/)
  assert.match(agents, /Migration Architecture/)
  assert.match(memory, /\/api\/whatsapp\/webhook/)
  assert.match(memory, /merge restore/i)
})

test("ops scripts are present in repo", () => {
  assert.ok(statSync("ops/aws-db-server-setup.sh").isFile())
  assert.ok(statSync("ops/aws-app-db-tunnel.sh").isFile())
})

test("final validation report emits required PASS/FAIL categories", () => {
  const source = read("scripts/production-validation-report.ts")
  for (const label of [
    "BUILD STATUS",
    "DATABASE STATUS",
    "MIGRATION STATUS",
    "BACKUP STATUS",
    "RESTORE STATUS",
    "PROXMOX STATUS",
    "WHATSAPP STATUS",
    "SSL STATUS",
    "SECURITY STATUS",
  ]) {
    assert.match(source, new RegExp(label))
  }
  assert.match(source, /RESTORE_VALIDATION_CMD/)
  assert.match(source, /PROXMOX_VALIDATION_CMD/)
  assert.match(source, /WHATSAPP_VALIDATION_CMD/)
})
