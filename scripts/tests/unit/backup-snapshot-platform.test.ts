import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { normalizeBackupStatus, selectRetainedBackups } from "@/lib/proxmox-backup"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8")

const rows = (count: number, protectedEvery = 0) =>
  Array.from({ length: count }, (_, i) => ({
    id: `backup-${i}`,
    metadata: (protectedEvery > 0 && (i + 1) % protectedEvery === 0 ? { isProtected: true } : {}) as Record<string, unknown>,
  }))

test("retention keeps last N unprotected backups in descending order", () => {
  const result = selectRetainedBackups(rows(7), 5)
  assert.equal(result.toTrim.length, 2)
  assert.deepEqual(result.toTrim.map((b) => b.id), ["backup-5", "backup-6"])
  assert.equal(result.retained.length, 5)
  assert.deepEqual(result.retained.map((b) => b.id), ["backup-0", "backup-1", "backup-2", "backup-3", "backup-4"])
})

test("protected backups are never trimmed, even beyond the retention window", () => {
  const dump10mr1 = rows(10, 3)
  const result = selectRetainedBackups(dump10mr1, 2)
  const protectedIds = dump10mr1.filter((b) => b.metadata.isProtected === true).map((b) => b.id)
  // newest 2 unprotected kept; all protected survive trimming
  const trimmedIds = new Set(result.toTrim.map((b) => b.id))
  for (const id of protectedIds) assert.equal(trimmedIds.has(id), false)
  assert.equal(result.protectedCount, protectedIds.length)
  // only unprotected rows can be trimmed
  for (const row of result.toTrim) assert.equal(row.metadata.isProtected !== true, true)
})

test("retention zero trims every unprotected backup and sources are intact", () => {
  const result = selectRetainedBackups(rows(4), 0)
  assert.equal(result.toTrim.length, 4)
  assert.equal(result.retained.length, 0)
})

test("normalizeBackupStatus maps unknown statuses to queued and keeps valid ones", () => {
  assert.equal(normalizeBackupStatus("completed"), "completed")
  assert.equal(normalizeBackupStatus("running"), "running")
  assert.equal(normalizeBackupStatus("queued"), "queued")
  assert.equal(normalizeBackupStatus("weird"), "queued")
  assert.equal(normalizeBackupStatus(""), "queued")
  assert.equal(normalizeBackupStatus("CANCELLED"), "cancelled")
})

test("VM backup policy model and migration are additive", () => {
  const schema = read("prisma/schema.prisma")
  const migration = read("prisma/migrations/20260914000000_vm_backup_policies/migration.sql")
  assert.match(schema, /model VmBackupPolicy \{[^}]*scheduleMinutes[^}]*retention[^}]*\}/s)
  assert.match(schema, /@@map\("vm_backup_policies"\)/)
  assert.match(migration, /CREATE TABLE "vm_backup_policies"/)
  assert.doesNotMatch(migration, /DROP TABLE|ALTER TABLE .* DROP|DELETE FROM/)
})

test("backup scheduler is registered in the worker entrypoint", () => {
  const scheduler = read("workers/zws-scheduler.ts")
  assert.match(scheduler, /vm-backup-scheduler|backupScheduler|runVmBackupScheduler/)
})

test("VM snapshots expose create, delete and rollback through the admin API", () => {
  const service = read("lib/proxmox-snapshots.ts")
  const route = read("app/api/admin/snapshots/route.ts")
  assert.match(service, /createVmSnapshot/)
  assert.match(service, /deleteVmSnapshot/)
  assert.match(service, /rollbackVmSnapshot/)
  assert.match(service, /recordSnapshotFailure/)
  assert.match(route, /get\("action"\) === "rollback"/)
  assert.match(route, /listSnapshotsForVm|listSnapshotVmCandidates/)
})