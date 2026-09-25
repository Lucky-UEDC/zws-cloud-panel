import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { destructiveSqlFindings, supportedUploadedBackupType } from "@/lib/backups"

function read(path: string) {
  return readFileSync(path, "utf8")
}

test("backup uploads support fresh pg_dump custom artifacts", () => {
  assert.equal(supportedUploadedBackupType("source.dump"), "pg_dump_custom")
  assert.equal(supportedUploadedBackupType("source.backup"), "pg_dump_custom")
  assert.equal(supportedUploadedBackupType("source.sql.gz"), "sql.gz")
})

test("merge restore blocks destructive SQL before touching production tables", () => {
  const sql = "DROP SCHEMA public CASCADE; TRUNCATE customers; DELETE FROM orders;"
  assert.deepEqual(destructiveSqlFindings(sql), ["DROP SCHEMA", "TRUNCATE", "DELETE FROM"])
})

test("restore implementation is merge-only and creates rollback metadata", () => {
  const source = read("lib/backups.ts")
  assert.match(source, /Full restore is disabled in production/)
  assert.match(source, /runMergeOnlyRestore/)
  assert.match(source, /registerLocalBackupArtifact/)
  assert.match(source, /triggerType: "pre_merge_restore"/)
  assert.match(source, /ON CONFLICT \(\$\{usablePk\.map\(qIdent\)\.join\(", "\)\}\) DO NOTHING/)
  assert.match(source, /DROP SCHEMA IF EXISTS \$\{qIdent\(importSchema\)\} CASCADE/)
  assert.match(source, /addMissingEnumValues/)
  assert.match(source, /addMissingIndexes/)
  assert.match(source, /syncTableSequences/)
  assert.match(source, /rowCountDeltas/)
})

test("backup UI exposes dry run and merge restore but not full restore", () => {
  const page = read("app/admin/backups/page.tsx")
  assert.match(page, /Dry Run/)
  assert.match(page, /Merge Restore/)
  assert.match(page, /Download/)
  assert.match(page, /MERGE RESTORE/)
  assert.doesNotMatch(page, /Full Restore/)
  assert.doesNotMatch(page, /RESTORE DATABASE/)
})

test("backup detector chooses newest valid backup and fails on ambiguous newest artifacts", () => {
  const source = read("scripts/detect-backup-artifact.ts")
  assert.match(source, /BACKUP_DETECT_ROOTS/)
  assert.match(source, /\.sql\.gz/)
  assert.match(source, /pg_restore/)
  assert.match(source, /multiple_newest_backups_differ/)
  assert.match(source, /selected/)
})

test("merge backup CLI registers detected artifacts and requires explicit merge confirmation", () => {
  const source = read("scripts/merge-backup-artifact.ts")
  const pkg = read("package.json")
  assert.match(source, /registerLocalBackupArtifact/)
  assert.match(source, /restoreBackup/)
  assert.match(source, /MERGE RESTORE/)
  assert.match(source, /BACKUP_ARTIFACT/)
  assert.match(pkg, /"backup:merge": "tsx scripts\/merge-backup-artifact\.ts"/)
})
