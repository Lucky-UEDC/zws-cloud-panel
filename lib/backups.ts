import { execFile } from "node:child_process"
import crypto from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import { requireSecret } from "@/lib/security/env-secret"
import path from "node:path"
import { promisify } from "node:util"
import { pipeline } from "node:stream/promises"
import { prisma } from "@/lib/db"
import { sanitizePostgresUrlForPgDump } from "@/lib/db-url"
import { getServiceIntegrationConfig } from "@/lib/integration-config"
import { uploadBackupToGoogleDrive } from "@/lib/google-drive-backup"
import { writeAuditLog } from "@/lib/audit-log"

const execFileAsync = promisify(execFile)

const DEFAULT_SCOPE = ["database"] as const
const FILE_SCOPE_ITEMS = ["public/uploads", "uploads", "release-artifacts", "config", "ecosystem.config.js", "package.json", "prisma/schema.prisma"] as const
const ROOT_DIR = process.env.ZWS_ROOT_DIR || path.join(/*turbopackIgnore: true*/ process.cwd())
const BACKUP_DIR = process.env.ZWS_BACKUP_DIR || path.join(/*turbopackIgnore: true*/ ROOT_DIR, "backups")

class BackupTaskError extends Error {
  constructor(publicMessage: string, publicDetails: string, public log: string) {
    super(`${publicMessage}\n\nDetails:\n${publicDetails}`)
    this.name = "BackupTaskError"
  }
}

function safeScope(scope: unknown) {
  const requested = Array.isArray(scope) ? scope.map(String) : []
  const normalized = requested.includes("full")
    ? ["full"]
    : requested.map((item) => item === "db" ? "database" : item === "site" || item === "uploads" || item === "releases" ? "files" : item)
  const allowed = new Set(["database", "files", "full"])
  const filtered = normalized.filter((item) => allowed.has(item as any))
  return filtered.length ? filtered : [...DEFAULT_SCOPE]
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-")
}

async function exists(value: string) {
  return stat(value).then(() => true).catch(() => false)
}

async function directorySize(dir: string): Promise<number> {
  if (!await exists(dir)) return 0
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  let size = 0
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) size += await directorySize(full)
    else size += await stat(full).then((info) => info.size).catch(() => 0)
  }
  return size
}

async function run(command: string, args: string[], cwd = ROOT_DIR) {
  try {
    const result = await execFileAsync(command, args, { cwd, maxBuffer: 1024 * 1024 * 20 })
    return [result.stdout, result.stderr].filter(Boolean).join("\n")
  } catch (error: any) {
    error.commandName = command
    error.commandArgs = args
    throw error
  }
}

function redactUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.password) url.password = "********"
    return url.toString()
  } catch {
    return value.replace(/(:\/\/[^:\s]+:)([^@\s]+)(@)/g, "$1********$3")
  }
}

function commandFailureText(error: any) {
  return [
    error?.stdout,
    error?.stderr,
    error?.message,
  ].map((item) => String(item || "").trim()).filter(Boolean).join("\n")
}

function commandFailureLog(error: any) {
  const command = String(error?.commandName || "command")
  const args = Array.isArray(error?.commandArgs) ? error.commandArgs.map((arg: unknown) => redactUrl(String(arg))) : []
  return [
    `Command failed: ${[command, ...args].join(" ")}`,
    commandFailureText(error).replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, (match) => redactUrl(match)),
  ].filter(Boolean).join("\n")
}

function databaseBackupDetails(error: any) {
  const text = commandFailureText(error)
  if (/invalid URI query parameter|connection_limit|pool_timeout|pgbouncer|schema/i.test(text)) {
    return "Unsupported PostgreSQL connection parameters detected. Configuration automatically repaired. Please retry backup."
  }
  const detail = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/^Command failed:/i.test(line) && !/postgres(?:ql)?:\/\//i.test(line))
  return detail || "PostgreSQL dump did not complete. Open logs for command output."
}

function backupEncryptionKey() {
  return crypto.createHash("sha256").update(requireSecret(["BACKUP_ENCRYPTION_KEY", "ENCRYPTION_KEY", "SECRET_ENCRYPTION_KEY", "NEXTAUTH_SECRET"], "zws-development-backup-key")).digest()
}

async function sha256File(filePath: string) {
  const hash = crypto.createHash("sha256")
  await pipeline(createReadStream(filePath), hash as any)
  return hash.digest("hex")
}

async function encryptArchive(localPath: string) {
  const encryptedPath = `${localPath}.enc`
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", backupEncryptionKey(), iv)
  await pipeline(createReadStream(localPath), cipher, createWriteStream(encryptedPath))
  const tag = cipher.getAuthTag()
  const metaPath = `${encryptedPath}.meta`
  await import("node:fs/promises").then((fs) => fs.writeFile(metaPath, JSON.stringify({ algorithm: "aes-256-gcm", iv: iv.toString("base64"), tag: tag.toString("base64") }, null, 2)))
  return {
    encryptedPath,
    checksumSha256: await sha256File(encryptedPath),
    sizeBytes: await stat(encryptedPath).then((info) => info.size).catch(() => 0),
  }
}

async function decryptArchive(encryptedPath: string, targetPath: string) {
  const metaPath = `${encryptedPath}.meta`
  const meta = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(metaPath, "utf8")))
  const decipher = crypto.createDecipheriv("aes-256-gcm", backupEncryptionKey(), Buffer.from(String(meta.iv), "base64"))
  decipher.setAuthTag(Buffer.from(String(meta.tag), "base64"))
  await pipeline(createReadStream(encryptedPath), decipher, createWriteStream(targetPath))
}

async function gzipFile(sourcePath: string) {
  await run("gzip", ["-f", sourcePath])
}

async function createDatabaseBackup(runId: string) {
  await mkdir(BACKUP_DIR, { recursive: true })
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for database backups.")
  const base = `zws-db-${timestamp()}-${runId.slice(0, 8)}`
  const dumpPath = path.join(BACKUP_DIR, `${base}.sql`)
  const localPath = path.join(BACKUP_DIR, `${base}.sql.gz`)
  let dumpLog = ""
  try {
    dumpLog = await run("pg_dump", [sanitizePostgresUrlForPgDump(process.env.DATABASE_URL), "-f", dumpPath], ROOT_DIR)
  } catch (error: any) {
    throw new BackupTaskError("Database backup failed", databaseBackupDetails(error), commandFailureLog(error))
  }
  await gzipFile(dumpPath)
  const checksumSha256 = await sha256File(localPath)
  const sizeBytes = await stat(localPath).then((info) => info.size).catch(() => 0)
  return { localPath, type: "database", contentType: "application/gzip", log: dumpLog, checksumSha256, sizeBytes }
}

async function createFilesBackup(runId: string) {
  await mkdir(BACKUP_DIR, { recursive: true })
  const localPath = path.join(BACKUP_DIR, `zws-files-${timestamp()}-${runId.slice(0, 8)}.tar.gz`)
  const existingIncludes: string[] = []
  for (const item of FILE_SCOPE_ITEMS) {
    if (await exists(path.join(ROOT_DIR, item))) existingIncludes.push(item)
  }
  if (!existingIncludes.length) existingIncludes.push("package.json", "prisma/schema.prisma")
  const tarLog = await run("tar", [
    "--exclude=node_modules",
    "--exclude=.next/cache",
    "--exclude=backups",
    "--exclude=.env",
    "--exclude=.env.*",
    "-czf",
    localPath,
    ...existingIncludes,
  ], ROOT_DIR)
  const checksumSha256 = await sha256File(localPath)
  const sizeBytes = await stat(localPath).then((info) => info.size).catch(() => 0)
  return { localPath, type: "files", contentType: "application/gzip", log: tarLog, checksumSha256, sizeBytes }
}

async function createFullBackup(runId: string) {
  await mkdir(BACKUP_DIR, { recursive: true })
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "zws-full-backup-"))
  const db = await createDatabaseBackup(runId)
  const dbCopy = path.join(tempDir, "db.sql.gz")
  await import("node:fs/promises").then((fs) => fs.copyFile(db.localPath, dbCopy))
  const localPath = path.join(BACKUP_DIR, `zws-full-${timestamp()}-${runId.slice(0, 8)}.tar.gz`)
  const includes: string[] = ["db.sql.gz"]
  for (const item of FILE_SCOPE_ITEMS) {
    if (await exists(path.join(ROOT_DIR, item))) includes.push(path.join(ROOT_DIR, item))
  }
  const tarLog = await run("tar", [
    "--exclude=node_modules",
    "--exclude=.next/cache",
    "--exclude=backups",
    "--exclude=.env",
    "--exclude=.env.*",
    "-czf",
    localPath,
    "-C",
    tempDir,
    "db.sql.gz",
    ...includes.slice(1),
  ], ROOT_DIR)
  await import("node:fs/promises").then((fs) => fs.rm(tempDir, { recursive: true, force: true })).catch(() => undefined)
  const checksumSha256 = await sha256File(localPath)
  const sizeBytes = await stat(localPath).then((info) => info.size).catch(() => 0)
  return { localPath, type: "full", contentType: "application/gzip", log: [db.log, tarLog].filter(Boolean).join("\n"), checksumSha256, sizeBytes }
}

async function createLocalArtifact(runId: string, scope: string[]) {
  if (scope.includes("full")) return createFullBackup(runId)
  if (scope.includes("files") && !scope.includes("database")) return createFilesBackup(runId)
  if (scope.includes("files") && scope.includes("database")) return createFullBackup(runId)
  return createDatabaseBackup(runId)
}

function safeUploadedBackupName(name: string) {
  const base = path.basename(String(name || "backup.sql.gz")).replace(/[^a-zA-Z0-9._-]/g, "-")
  return base || "backup.sql.gz"
}

export function supportedUploadedBackupType(fileName: string) {
  const lower = fileName.toLowerCase()
  if (lower.endsWith(".sql")) return "sql"
  if (lower.endsWith(".sql.gz")) return "sql.gz"
  if (lower.endsWith(".dump") || lower.endsWith(".backup")) return "pg_dump_custom"
  if (lower.endsWith(".zip")) return "zip"
  return null
}

export function destructiveSqlFindings(sql: string) {
  const findings: string[] = []
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
  const checks: Array<[RegExp, string]> = [
    [/\bdrop\s+database\b/i, "DROP DATABASE"],
    [/\bdrop\s+schema\b/i, "DROP SCHEMA"],
    [/\btruncate\b/i, "TRUNCATE"],
    [/\bdelete\s+from\b/i, "DELETE FROM"],
    [/\balter\s+table\b[\s\S]{0,200}\bdrop\s+(column|constraint)\b/i, "ALTER TABLE DROP"],
    [/\bdrop\s+table\b/i, "DROP TABLE"],
  ]
  for (const [pattern, label] of checks) {
    if (pattern.test(stripped)) findings.push(label)
  }
  return findings
}

async function assertBackupReadable(filePath: string) {
  if (filePath.endsWith(".sql.gz")) {
    await run("gzip", ["-t", filePath], ROOT_DIR)
    return "SQL gzip readable."
  }
  if (filePath.endsWith(".zip")) {
    return run("unzip", ["-t", filePath], ROOT_DIR)
  }
  if (filePath.endsWith(".dump") || filePath.endsWith(".backup")) {
    return run("pg_restore", ["-l", filePath], ROOT_DIR)
  }
  if (filePath.endsWith(".sql")) {
    const info = await stat(filePath)
    if (!info.size) throw new Error("SQL backup is empty.")
    return "SQL file readable."
  }
  throw new Error("Unsupported backup file type.")
}

export async function uploadBackupArtifact(input: { fileName: string; bytes: Buffer; createdBy?: string | null }) {
  const originalName = safeUploadedBackupName(input.fileName)
  const kind = supportedUploadedBackupType(originalName)
  if (!kind) throw Object.assign(new Error("Unsupported backup type. Upload .sql, .sql.gz, .dump, .backup, or .zip."), { status: 400 })
  if (!input.bytes?.length) throw Object.assign(new Error("Backup file is empty."), { status: 400 })
  await mkdir(BACKUP_DIR, { recursive: true })
  const destination = await ensureRuntimeBackupDestination(input.createdBy || null)
  const localPath = path.join(BACKUP_DIR, `uploaded-${timestamp()}-${originalName}`)
  await writeFile(localPath, input.bytes)
  const readableLog = await assertBackupReadable(localPath)
  const checksumSha256 = await sha256File(localPath)
  const sizeBytes = await stat(localPath).then((info) => info.size).catch(() => input.bytes.length)
  const runRow = await (prisma as any).backupRun.create({
    data: {
      destinationId: destination.id,
      triggerType: "upload",
      status: "completed",
      scope: ["database", "upload", kind],
      localPath,
      checksumSha256,
      sizeBytes: BigInt(sizeBytes),
      log: [`Uploaded backup: ${originalName}`, `Type: ${kind}`, readableLog, `SHA-256: ${checksumSha256}`].join("\n"),
      startedAt: new Date(),
      completedAt: new Date(),
      createdBy: input.createdBy || null,
    },
  })
  await writeAuditLog({
    action: "backup.uploaded",
    actorEmail: input.createdBy || null,
    targetType: "backup_run",
    targetId: runRow.id,
    metadata: { fileName: originalName, kind, sizeBytes, checksumSha256 },
  }).catch(() => null)
  return runRow
}

export async function registerLocalBackupArtifact(input: { filePath: string; createdBy?: string | null }) {
  const localPath = path.resolve(input.filePath)
  const originalName = safeUploadedBackupName(path.basename(localPath))
  const kind = supportedUploadedBackupType(originalName)
  if (!kind) throw Object.assign(new Error("Unsupported backup type. Register .sql, .sql.gz, .dump, .backup, or .zip."), { status: 400 })
  const info = await stat(localPath).catch(() => null)
  if (!info?.isFile()) throw Object.assign(new Error("Backup artifact is not a readable file."), { status: 404 })
  const readableLog = await assertBackupReadable(localPath)
  const destination = await ensureRuntimeBackupDestination(input.createdBy || null)
  const checksumSha256 = await sha256File(localPath)
  const runRow = await (prisma as any).backupRun.create({
    data: {
      destinationId: destination.id,
      triggerType: "detected_import",
      status: "completed",
      scope: ["database", "detected", kind],
      localPath,
      checksumSha256,
      sizeBytes: BigInt(info.size),
      log: [`Registered local backup: ${originalName}`, `Type: ${kind}`, readableLog, `SHA-256: ${checksumSha256}`].join("\n"),
      startedAt: new Date(),
      completedAt: new Date(),
      createdBy: input.createdBy || null,
    },
  })
  await writeAuditLog({
    action: "backup.registered_local_artifact",
    actorEmail: input.createdBy || null,
    targetType: "backup_run",
    targetId: runRow.id,
    metadata: { fileName: originalName, kind, sizeBytes: info.size, checksumSha256, localPath },
  }).catch(() => null)
  return runRow
}

async function sqlPathForRestore(filePath: string) {
  if (filePath.endsWith(".sql")) return { path: filePath, cleanupDir: null as string | null }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "zws-restore-"))
  if (filePath.endsWith(".sql.gz")) {
    const out = path.join(tempDir, "restore.sql")
    await run("gzip", ["-dc", filePath], ROOT_DIR).then((sql) => writeFile(out, sql))
    return { path: out, cleanupDir: tempDir }
  }
  if (filePath.endsWith(".zip")) {
    const list = await run("unzip", ["-Z1", filePath], ROOT_DIR)
    const candidates = list.split(/\r?\n/).map((item) => item.trim()).filter((item) => item.endsWith(".sql"))
    if (candidates.length !== 1) throw new Error("Zip backup must contain exactly one .sql file for restore.")
    const entry = candidates[0]
    const extracted = await run("unzip", ["-p", filePath, entry], ROOT_DIR)
    const out = path.join(tempDir, "restore.sql")
    await writeFile(out, extracted)
    return { path: out, cleanupDir: tempDir }
  }
  throw new Error("Unsupported backup file type.")
}

async function sqlPathForMerge(filePath: string) {
  if (filePath.endsWith(".dump") || filePath.endsWith(".backup")) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zws-merge-"))
    const out = path.join(tempDir, "restore.sql")
    await run("pg_restore", ["--no-owner", "--no-privileges", "-f", out, filePath], ROOT_DIR)
    return { path: out, cleanupDir: tempDir }
  }
  return sqlPathForRestore(filePath)
}

function qIdent(value: string) {
  return `"${String(value).replace(/"/g, "\"\"")}"`
}

function sqlLit(value: string) {
  return `'${String(value).replace(/'/g, "''")}'`
}

async function psql(args: string[], cwd = ROOT_DIR) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.")
  return run("psql", [sanitizePostgresUrlForPgDump(process.env.DATABASE_URL), ...args], cwd)
}

async function psqlExec(sql: string) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "zws-psql-"))
  const sqlFile = path.join(tempDir, "command.sql")
  try {
    await writeFile(sqlFile, sql)
    return await psql(["-v", "ON_ERROR_STOP=1", "-f", sqlFile])
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function psqlRows(sql: string) {
  const out = await psql(["-X", "-q", "-t", "-A", "-F", "\t", "-c", sql])
  return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => line.split("\t"))
}

function rewriteDumpSqlForImportSchema(sql: string, schema: string) {
  const schemaName = qIdent(schema)
  return sql
    .replace(/^\s*CREATE\s+SCHEMA\s+public\s*;\s*$/gim, "")
    .replace(/^\s*ALTER\s+SCHEMA\s+public\s+OWNER\s+TO\s+[^;]+;\s*$/gim, "")
    .replace(/\bpublic\./g, `${schemaName}.`)
    .replace(/\bSCHEMA\s+public\b/g, `SCHEMA ${schemaName}`)
    .replace(/\bSET\s+search_path\s*=\s*public\b/gi, `SET search_path = ${schemaName}`)
}

async function tableExists(schema: string, table: string) {
  const rows = await psqlRows(`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = ${sqlLit(schema)}
      AND table_name = ${sqlLit(table)}
      AND table_type = 'BASE TABLE'
    LIMIT 1
  `)
  return rows.length > 0
}

async function tableColumns(schema: string, table: string) {
  const rows = await psqlRows(`
    SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod)
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${sqlLit(schema)}
      AND c.relname = ${sqlLit(table)}
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY a.attnum
  `)
  return rows.map(([name, type]) => ({ name, type }))
}

async function primaryKeyColumns(schema: string, table: string) {
  const rows = await psqlRows(`
    SELECT a.attname
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
    WHERE n.nspname = ${sqlLit(schema)}
      AND c.relname = ${sqlLit(table)}
      AND i.indisprimary
    ORDER BY array_position(i.indkey, a.attnum)
  `)
  return rows.map(([name]) => name)
}

async function enumValues(schema: string) {
  const rows = await psqlRows(`
    SELECT t.typname, e.enumlabel
    FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = ${sqlLit(schema)}
    ORDER BY t.typname, e.enumsortorder
  `)
  const values = new Map<string, string[]>()
  for (const [typeName, value] of rows) {
    const list = values.get(typeName) || []
    list.push(value)
    values.set(typeName, list)
  }
  return values
}

async function addMissingEnumValues(input: { importSchema: string; dryRun: boolean }) {
  const imported = await enumValues(input.importSchema)
  const target = await enumValues("public")
  const added: string[] = []
  for (const [typeName, importValues] of imported) {
    const targetValues = new Set(target.get(typeName) || [])
    if (!target.has(typeName)) continue
    for (const value of importValues) {
      if (targetValues.has(value)) continue
      added.push(`${typeName}.${value}`)
      if (!input.dryRun) {
        await psqlExec(`ALTER TYPE ${qIdent("public")}.${qIdent(typeName)} ADD VALUE IF NOT EXISTS ${sqlLit(value)};`)
      }
    }
  }
  return added
}

type IndexInfo = {
  name: string
  unique: boolean
  columns: string
  definition: string
}

async function tableIndexes(schema: string, table: string): Promise<IndexInfo[]> {
  const rows = await psqlRows(`
    SELECT
      i.relname,
      ix.indisunique::text,
      COALESCE(string_agg(a.attname, ',' ORDER BY keys.ordinality), ''),
      pg_get_indexdef(i.oid)
    FROM pg_class t
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    LEFT JOIN unnest(ix.indkey) WITH ORDINALITY AS keys(attnum, ordinality) ON keys.attnum > 0
    LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = keys.attnum
    WHERE n.nspname = ${sqlLit(schema)}
      AND t.relname = ${sqlLit(table)}
      AND ix.indisprimary = false
    GROUP BY i.relname, ix.indisunique, i.oid
    ORDER BY i.relname
  `)
  return rows.map(([name, unique, columns, definition]) => ({
    name,
    unique: unique === "true",
    columns,
    definition,
  }))
}

function indexSignature(index: IndexInfo) {
  return `${index.unique ? "unique" : "index"}:${index.columns || index.definition.replace(/\s+/g, " ")}`
}

function rewriteIndexDefinition(index: IndexInfo, targetTable: string) {
  const match = index.definition.match(/\sON\s+(?:"?[^".\s]+"?\.)?"?[^"\s]+"?\s+(.+)$/i)
  if (!match?.[1]) throw new Error(`Unable to rewrite index definition for ${index.name}`)
  const hash = crypto.createHash("sha1").update(`${targetTable}:${index.name}:${index.definition}`).digest("hex").slice(0, 8)
  const indexName = `${targetTable}_${hash}_merge_idx`.slice(0, 60)
  return `CREATE ${index.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${qIdent(indexName)} ON ${qIdent("public")}.${qIdent(targetTable)} ${match[1]};`
}

async function addMissingIndexes(input: { importSchema: string; table: string; dryRun: boolean }) {
  const [importIndexes, targetIndexes] = await Promise.all([
    tableIndexes(input.importSchema, input.table),
    tableIndexes("public", input.table),
  ])
  const targetSignatures = new Set(targetIndexes.map(indexSignature))
  const missing = importIndexes.filter((index) => !targetSignatures.has(indexSignature(index)))
  if (!input.dryRun) {
    for (const index of missing) await psqlExec(rewriteIndexDefinition(index, input.table))
  }
  return missing
}

async function syncTableSequences(table: string) {
  const columns = await tableColumns("public", table)
  let synced = 0
  for (const column of columns) {
    const sequenceRows = await psqlRows(`SELECT pg_get_serial_sequence(${sqlLit(`public.${table}`)}, ${sqlLit(column.name)})`)
    const sequence = sequenceRows[0]?.[0]
    if (!sequence) continue
    await psqlExec(`
      SELECT setval(
        ${sqlLit(sequence)}::regclass,
        GREATEST(COALESCE((SELECT max(${qIdent(column.name)})::bigint FROM ${qIdent("public")}.${qIdent(table)}), 0), 1),
        COALESCE((SELECT max(${qIdent(column.name)}) FROM ${qIdent("public")}.${qIdent(table)}), 0) IS NOT NULL
      );
    `)
    synced += 1
  }
  return synced
}

async function tableCount(schema: string, table: string) {
  const rows = await psqlRows(`SELECT count(*)::text FROM ${qIdent(schema)}.${qIdent(table)}`)
  return Number(rows[0]?.[0] || 0)
}

async function importSchemaTables(schema: string) {
  const rows = await psqlRows(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = ${sqlLit(schema)}
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `)
  return rows.map(([table]) => table).filter((table) => table !== "_prisma_migrations")
}

async function mergeImportSchema(input: { importSchema: string; dryRun: boolean; tables?: string[] }) {
  const importSchema = input.importSchema
  const requested = new Set((input.tables || []).map((table) => String(table).trim()).filter(Boolean))
  const allTables = await importSchemaTables(importSchema)
  const selectedTables = requested.size ? allTables.filter((table) => requested.has(table)) : allTables
  const summary = {
    mode: input.dryRun ? "DRY_RUN" : "MERGE_RESTORE",
    tablesScanned: selectedTables.length,
    tablesCreated: 0,
    columnsAdded: 0,
    indexesCreated: 0,
    enumValuesAdded: 0,
    sequencesSynced: 0,
    rowsInserted: 0,
    rowCountDeltas: [] as Array<{ table: string; before: number; after: number; imported: number }>,
    skippedTables: [] as Array<{ table: string; reason: string }>,
    warnings: [] as string[],
    details: [] as string[],
  }

  const enumAdds = await addMissingEnumValues({ importSchema, dryRun: input.dryRun })
  summary.enumValuesAdded = enumAdds.length
  if (enumAdds.length) summary.details.push(`${input.dryRun ? "would add" : "added"} enum values: ${enumAdds.join(", ")}`)

  for (const table of selectedTables) {
    const importCount = await tableCount(importSchema, table)
    const targetExists = await tableExists("public", table)
    if (!targetExists) {
      summary.tablesCreated += 1
      summary.rowsInserted += importCount
      summary.rowCountDeltas.push({ table, before: 0, after: input.dryRun ? 0 : importCount, imported: importCount })
      summary.details.push(`${table}: ${input.dryRun ? "would create table and import" : "created table and imported"} ${importCount} row(s)`)
      if (!input.dryRun) {
        await psqlExec(`
          CREATE TABLE ${qIdent("public")}.${qIdent(table)} (LIKE ${qIdent(importSchema)}.${qIdent(table)} INCLUDING ALL);
          INSERT INTO ${qIdent("public")}.${qIdent(table)} SELECT * FROM ${qIdent(importSchema)}.${qIdent(table)};
        `)
      }
      continue
    }

    const targetCountBefore = await tableCount("public", table)
    const importColumns = await tableColumns(importSchema, table)
    const targetColumnsBefore = await tableColumns("public", table)
    const targetColumnNames = new Set(targetColumnsBefore.map((column) => column.name))
    const missingColumns = importColumns.filter((column) => !targetColumnNames.has(column.name))
    summary.columnsAdded += missingColumns.length
    if (missingColumns.length) {
      summary.details.push(`${table}: ${input.dryRun ? "would add" : "added"} ${missingColumns.map((column) => column.name).join(", ")}`)
      if (!input.dryRun) {
        for (const column of missingColumns) {
          await psqlExec(`ALTER TABLE ${qIdent("public")}.${qIdent(table)} ADD COLUMN ${qIdent(column.name)} ${column.type};`)
        }
      }
    }

    const targetColumns = input.dryRun ? targetColumnsBefore : await tableColumns("public", table)
    const importColumnNames = new Set(importColumns.map((column) => column.name))
    const commonColumns = targetColumns.map((column) => column.name).filter((column) => importColumnNames.has(column))
    if (!commonColumns.length) {
      summary.skippedTables.push({ table, reason: "no common columns" })
      summary.rowCountDeltas.push({ table, before: targetCountBefore, after: targetCountBefore, imported: importCount })
      continue
    }

    const pk = await primaryKeyColumns("public", table)
    const usablePk = pk.filter((column) => commonColumns.includes(column))
    if (!usablePk.length) {
      const targetCount = await tableCount("public", table)
      if (targetCount > 0) {
        summary.skippedTables.push({ table, reason: "no primary key and target table is not empty" })
        summary.warnings.push(`${table}: skipped row import because the target is non-empty and no primary key exists`)
        summary.rowCountDeltas.push({ table, before: targetCountBefore, after: targetCountBefore, imported: importCount })
        continue
      }
      summary.rowsInserted += importCount
      summary.rowCountDeltas.push({ table, before: targetCountBefore, after: input.dryRun ? targetCountBefore : targetCountBefore + importCount, imported: importCount })
      summary.details.push(`${table}: ${input.dryRun ? "would import" : "imported"} ${importCount} row(s) into empty table without primary key`)
      if (!input.dryRun) {
        await psqlExec(`
          INSERT INTO ${qIdent("public")}.${qIdent(table)} (${commonColumns.map(qIdent).join(", ")})
          SELECT ${commonColumns.map(qIdent).join(", ")} FROM ${qIdent(importSchema)}.${qIdent(table)};
        `)
      }
      continue
    }

    const before = targetCountBefore
    summary.details.push(`${table}: ${input.dryRun ? "would upsert missing primary-key rows from" : "upserting missing primary-key rows from"} ${importCount} source row(s)`)
    if (!input.dryRun) {
      await psqlExec(`
        INSERT INTO ${qIdent("public")}.${qIdent(table)} (${commonColumns.map(qIdent).join(", ")})
        SELECT ${commonColumns.map((column) => `src.${qIdent(column)}`).join(", ")}
        FROM ${qIdent(importSchema)}.${qIdent(table)} src
        ON CONFLICT (${usablePk.map(qIdent).join(", ")}) DO NOTHING;
      `)
      const after = await tableCount("public", table)
      summary.rowsInserted += Math.max(0, after - before)
      summary.rowCountDeltas.push({ table, before, after, imported: importCount })
    } else {
      summary.rowCountDeltas.push({ table, before, after: before, imported: importCount })
    }

    const missingIndexes = await addMissingIndexes({ importSchema, table, dryRun: input.dryRun })
    summary.indexesCreated += missingIndexes.length
    if (missingIndexes.length) summary.details.push(`${table}: ${input.dryRun ? "would create" : "created"} ${missingIndexes.length} missing index(es)`)
    if (!input.dryRun) summary.sequencesSynced += await syncTableSequences(table)
  }
  return summary
}

async function runMergeOnlyRestore(input: { localPath: string; dryRun: boolean; tables?: string[] }) {
  const resolved = await sqlPathForMerge(input.localPath)
  const importSchema = `zws_import_${Date.now().toString(36)}`
  try {
    const sql = await readFile(resolved.path, "utf8")
    const destructive = destructiveSqlFindings(sql)
    if (destructive.length) {
      throw new Error(`Backup contains destructive SQL and cannot be merge-restored: ${Array.from(new Set(destructive)).join(", ")}`)
    }
    await psqlExec(`DROP SCHEMA IF EXISTS ${qIdent(importSchema)} CASCADE; CREATE SCHEMA ${qIdent(importSchema)};`)
    await psqlExec(rewriteDumpSqlForImportSchema(sql, importSchema))
    const summary = await mergeImportSchema({ importSchema, dryRun: input.dryRun, tables: input.tables })
    return {
      summary,
      log: [
        `Merge-only ${input.dryRun ? "dry run" : "restore"} completed.`,
        `Import schema: ${importSchema}`,
        JSON.stringify(summary, null, 2),
      ].join("\n"),
    }
  } finally {
    await psqlExec(`DROP SCHEMA IF EXISTS ${qIdent(importSchema)} CASCADE;`).catch(() => undefined)
    if (resolved.cleanupDir) await rm(resolved.cleanupDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function restoreBackup(input: {
  backupRunId: string
  mode: "DRY_RUN" | "MERGE_RESTORE" | "FULL_RESTORE"
  confirmation: string
  tables?: string[]
  createdBy?: string | null
}) {
  if (input.mode === "FULL_RESTORE") {
    throw Object.assign(new Error("Full restore is disabled in production. Use dry run or merge restore."), { status: 400 })
  }
  if (input.mode === "DRY_RUN" && input.confirmation && input.confirmation !== "DRY RUN") {
    throw Object.assign(new Error("Invalid dry-run confirmation."), { status: 400 })
  }
  if (input.mode === "MERGE_RESTORE" && input.confirmation !== "MERGE RESTORE") {
    throw Object.assign(new Error("Type MERGE RESTORE to confirm merge restore."), { status: 400 })
  }
  const backup = await (prisma as any).backupRun.findUnique({ where: { id: input.backupRunId } })
  if (!backup) throw Object.assign(new Error("Backup run not found."), { status: 404 })
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for database restore.")
  const localPath = String(backup.localPath || "")
  if (!localPath || !await exists(localPath)) throw Object.assign(new Error("Local backup archive is not available for restore."), { status: 404 })
  if (backup.checksumSha256) {
    const checksum = await sha256File(localPath)
    if (checksum !== backup.checksumSha256) throw new Error("Backup checksum mismatch.")
  }
  await assertBackupReadable(localPath)
  const restore = await (prisma as any).backupRestoreTest.create({
    data: { backupRunId: backup.id, status: "running", createdBy: input.createdBy || null, log: `Live restore requested: ${input.mode}` },
  })
  try {
    const rollback = input.mode === "MERGE_RESTORE"
      ? await createBackup({ createdBy: input.createdBy || "merge-restore-rollback", triggerType: "pre_merge_restore", scope: ["database"] })
      : null
    const merge = await runMergeOnlyRestore({
      localPath,
      dryRun: input.mode === "DRY_RUN",
      tables: (input.tables || []).map((table) => String(table || "").trim()).filter(Boolean),
    })
    const saved = await (prisma as any).backupRestoreTest.update({
      where: { id: restore.id },
      data: {
        status: "passed",
        log: [rollback ? `Rollback backup run: ${rollback.id}` : null, merge.log].filter(Boolean).join("\n").slice(0, 10000),
        testedAt: new Date(),
      },
    })
    await writeAuditLog({
      action: input.mode === "DRY_RUN" ? "backup.merge_dry_run" : "backup.merge_restored",
      actorEmail: input.createdBy || null,
      targetType: "backup_run",
      targetId: backup.id,
      metadata: { restoreId: restore.id, mode: input.mode, rollbackBackupRunId: rollback?.id || null, summary: merge.summary },
    }).catch(() => null)
    return saved
  } catch (error: any) {
    const saved = await (prisma as any).backupRestoreTest.update({
      where: { id: restore.id },
      data: { status: "failed", error: error?.message || String(error), testedAt: new Date() },
    })
    await writeAuditLog({
      action: "backup.restore_failed",
      actorEmail: input.createdBy || null,
      targetType: "backup_run",
      targetId: backup.id,
      metadata: { restoreId: restore.id, mode: input.mode, error: error?.message || String(error) },
    }).catch(() => null)
    return saved
  }
}

async function rcloneCopy(localPath: string, destination: any) {
  const remote = String(destination?.rcloneRemote || "")
  if (!remote) return { remotePath: null, log: "rclone remote not configured; local backup retained." }
  const remotePath = `${remote.replace(/\/+$/, "")}/${path.basename(localPath)}`
  const log = await run("rclone", ["copyto", localPath, remotePath], ROOT_DIR)
  return { remotePath, log }
}

async function uploadRemote(artifact: { localPath: string; checksumSha256: string; sizeBytes: number; contentType?: string; type?: string }, destination: any) {
  const provider = String(destination?.provider || "").toLowerCase()
  if (provider === "google_drive" || provider === "googledrive" || provider === "drive") {
    const uploaded = await uploadBackupToGoogleDrive({
      filePath: artifact.localPath,
      fileName: path.basename(artifact.localPath),
      contentType: artifact.contentType,
      sizeBytes: artifact.sizeBytes,
      checksumSha256: artifact.checksumSha256,
      backupType: artifact.type,
    })
    return { ...uploaded, log: `Uploaded backup to Google Drive as ${uploaded.remotePath}` }
  }
  const remote = await rcloneCopy(artifact.localPath, destination)
  return { ...remote, remoteChecksum: null }
}

export async function listBackupRuns() {
  const [destinations, runs] = await Promise.all([
    (prisma as any).backupDestination.findMany({ orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }] }).catch(() => []),
    (prisma as any).backupRun.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { destination: true, restoreTests: { orderBy: { createdAt: "desc" }, take: 3 } } }).catch(() => []),
  ])
  return { destinations, runs }
}

export async function recoverStaleBackupRuns(input: { maxAgeMinutes?: number; actor?: string | null } = {}) {
  const maxAgeMinutes = Math.max(15, Number(input.maxAgeMinutes || 180))
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000)
  const stale = await (prisma as any).backupRun.findMany({
    where: {
      status: "running",
      startedAt: { lt: cutoff },
      completedAt: null,
    },
    select: { id: true, destinationId: true, startedAt: true, log: true },
    take: 100,
  }).catch(() => [])
  for (const row of stale) {
    await (prisma as any).backupRun.update({
      where: { id: row.id },
      data: {
        status: "failed",
        error: `Backup marked failed by stale-run recovery after ${maxAgeMinutes} minutes.`,
        log: [row.log, `Stale backup recovery by ${input.actor || "system"} at ${new Date().toISOString()}.`].filter(Boolean).join("\n"),
        completedAt: new Date(),
      },
    }).catch(() => null)
    if (row.destinationId) {
      await (prisma as any).backupDestination.update({
        where: { id: row.destinationId },
        data: { lastRunAt: new Date(), lastStatus: "failed" },
      }).catch(() => null)
    }
  }
  return { repaired: stale.length, staleRunIds: stale.map((row: any) => row.id), maxAgeMinutes }
}

export async function ensureRuntimeBackupDestination(updatedBy?: string | null) {
  const [config, drive] = await Promise.all([
    getServiceIntegrationConfig("backups").catch(() => ({} as Record<string, unknown>)),
    getServiceIntegrationConfig("googleDriveBackups").catch(() => ({} as Record<string, unknown>)),
  ])
  const driveEnabled = drive.enabled === true || String(drive.enabled || "").toLowerCase() === "true"
  const provider = String(driveEnabled ? "google_drive" : config.provider || "local").toLowerCase()
  const remote = String(config.remote || config.rcloneRemote || "")
  const retentionDays = Math.max(1, Number(config.retentionDays || 30) || 30)
  const scheduleCron = String(config.scheduleCron || "")
  return (prisma as any).backupDestination.upsert({
    where: { id: "runtime-backup-destination" },
    create: {
      id: "runtime-backup-destination",
      name: provider === "local" ? "Local backups" : provider === "google_drive" ? "Google Drive backups" : `${provider} backups`,
      provider,
      enabled: true,
      rcloneRemote: remote || null,
      retentionDays,
      scheduleCron: scheduleCron || null,
      metadata: { source: "runtime_integrations" },
    },
    update: {
      provider,
      enabled: true,
      rcloneRemote: remote || null,
      retentionDays,
      scheduleCron: scheduleCron || null,
      metadata: { source: "runtime_integrations", updatedBy: updatedBy || null },
    },
  })
}

export async function createBackup(input: { createdBy?: string | null; scope?: unknown; triggerType?: string }) {
  const destination = await ensureRuntimeBackupDestination(input.createdBy || null)
  const scope = safeScope(input.scope)
  const runRow = await (prisma as any).backupRun.create({
    data: {
      destinationId: destination.id,
      triggerType: input.triggerType || "manual",
      status: "running",
      scope,
      startedAt: new Date(),
      createdBy: input.createdBy || null,
    },
  })
  try {
    const artifact = await createLocalArtifact(runRow.id, scope)
    let remote: { remotePath: string | null; log?: string; remoteChecksum?: string | null; webViewLink?: string | null; fileId?: string | null } = { remotePath: null, log: "" }
    try {
      remote = await uploadRemote(artifact, destination)
    } catch (error: any) {
      remote = { remotePath: null, log: `remote upload skipped/failed: ${error?.message || String(error)}` }
    }
    const saved = await (prisma as any).backupRun.update({
      where: { id: runRow.id },
      data: {
        status: "completed",
        localPath: artifact.localPath,
        remotePath: remote.remotePath,
        encryptedPath: null,
        checksumSha256: artifact.checksumSha256,
        remoteChecksum: remote.remoteChecksum || null,
        sizeBytes: BigInt(artifact.sizeBytes),
        log: [artifact.log, `Backup artifact: ${artifact.localPath}`, `Type: ${artifact.type}`, `SHA-256: ${artifact.checksumSha256}`, remote.log].filter(Boolean).join("\n"),
        completedAt: new Date(),
      },
    })
    await (prisma as any).backupDestination.update({ where: { id: destination.id }, data: { lastRunAt: new Date(), lastStatus: "completed" } }).catch(() => null)
    return saved
  } catch (error: any) {
    const cleanError = error instanceof BackupTaskError
      ? error.message
      : `Backup failed\n\nDetails:\n${error?.message && !/Command failed:|pg_dump|pg_restore|postgres(?:ql)?:\/\//i.test(error.message) ? error.message : "Backup operation did not complete. Open logs for details."}`
    const log = error instanceof BackupTaskError ? error.log : String(error?.stack || error?.message || error)
    const saved = await (prisma as any).backupRun.update({
      where: { id: runRow.id },
      data: { status: "failed", error: cleanError, log, completedAt: new Date() },
    })
    await (prisma as any).backupDestination.update({ where: { id: destination.id }, data: { lastRunAt: new Date(), lastStatus: "failed" } }).catch(() => null)
    return saved
  }
}

async function removeBackupFiles(backup: any) {
  const paths = [
    backup?.localPath,
    backup?.encryptedPath,
    backup?.encryptedPath ? `${backup.encryptedPath}.meta` : "",
  ].map((item) => String(item || "")).filter(Boolean)
  for (const filePath of paths) {
    if (!path.resolve(filePath).startsWith(path.resolve(BACKUP_DIR))) continue
    await rm(filePath, { force: true }).catch(() => undefined)
  }
}

export async function deleteBackupRun(id: string) {
  const backup = await (prisma as any).backupRun.findUnique({ where: { id } })
  if (!backup) throw Object.assign(new Error("Backup run not found."), { status: 404 })
  await removeBackupFiles(backup)
  await (prisma as any).backupRun.delete({ where: { id } })
  return { deleted: true, id }
}

export async function cleanupExpiredBackups(createdBy?: string | null) {
  const destination = await ensureRuntimeBackupDestination(createdBy || "retention-cleanup")
  const retentionDays = Math.max(1, Number(destination.retentionDays || 30) || 30)
  const before = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  const backups = await (prisma as any).backupRun.findMany({ where: { createdAt: { lt: before } } }).catch(() => [])
  for (const backup of backups) {
    await removeBackupFiles(backup)
    await (prisma as any).backupRun.delete({ where: { id: backup.id } }).catch(() => null)
  }
  return { deleted: backups.length, retentionDays, before: before.toISOString() }
}

export async function backupStorageUsed() {
  return directorySize(BACKUP_DIR)
}

export async function restoreTestBackup(id: string, createdBy?: string | null) {
  const backup = await (prisma as any).backupRun.findUnique({ where: { id } })
  if (!backup) throw Object.assign(new Error("Backup run not found."), { status: 404 })
  const test = await (prisma as any).backupRestoreTest.create({
    data: { backupRunId: id, status: "running", createdBy: createdBy || null },
  })
  try {
    const encryptedPath = String(backup.encryptedPath || "")
    const localPath = String(backup.localPath || "")
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "zws-restore-test-"))
    let archivePath = localPath
    let checksumLog = ""
    if (encryptedPath) {
      if (!await exists(encryptedPath)) throw new Error("Encrypted backup archive is not available for restore testing.")
      const checksum = await sha256File(encryptedPath)
      if (backup.checksumSha256 && checksum !== backup.checksumSha256) throw new Error("Encrypted backup checksum mismatch.")
      checksumLog = `Encrypted SHA-256 verified: ${checksum}`
      archivePath = path.join(tempDir, path.basename(localPath || encryptedPath.replace(/\.enc$/, "")))
      await decryptArchive(encryptedPath, archivePath)
    }
    if (!archivePath || !await exists(archivePath)) throw new Error("Local backup archive is not available for restore testing.")
    const listLog = archivePath.endsWith(".sql.gz")
      ? await run("gzip", ["-t", archivePath], ROOT_DIR).then(() => "Database gzip readable.")
      : await run("tar", ["-tzf", archivePath], ROOT_DIR)
    const sizeBytes = await directorySize(path.dirname(archivePath))
    return (prisma as any).backupRestoreTest.update({
      where: { id: test.id },
      data: { status: "passed", log: `${checksumLog}\nArchive readable.\n${listLog.slice(0, 4000)}\nRestore test directory bytes: ${sizeBytes}`.trim(), testedAt: new Date() },
    })
  } catch (error: any) {
    return (prisma as any).backupRestoreTest.update({
      where: { id: test.id },
      data: { status: "failed", error: error?.message || String(error), testedAt: new Date() },
    })
  }
}

export async function backupHealth() {
  const destination = await ensureRuntimeBackupDestination("health").catch(() => null)
  const lastRun = await (prisma as any).backupRun.findFirst({ orderBy: { createdAt: "desc" } }).catch(() => null)
  return {
    ok: Boolean(destination),
    destinationConfigured: Boolean(destination),
    provider: destination?.provider || null,
    remoteConfigured: Boolean(destination?.rcloneRemote),
    lastStatus: lastRun?.status || null,
    lastRunAt: lastRun?.createdAt?.toISOString?.() || null,
  }
}
