import { execFile } from "node:child_process"
import { createReadStream } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const DEFAULT_ROOTS = ["/root", "/root/backups", "/var/backups/zws-postgres", path.join(process.cwd(), "backups")]
const EXTENSIONS = [".sql", ".sql.gz", ".dump", ".backup"]

type Candidate = {
  path: string
  kind: "sql" | "sql.gz" | "pg_dump_custom"
  size: number
  mtimeMs: number
  mtime: string
}

function roots() {
  return (process.env.BACKUP_DETECT_ROOTS || DEFAULT_ROOTS.join(":"))
    .split(":")
    .map((item) => item.trim())
    .filter(Boolean)
}

function kindFor(filePath: string): Candidate["kind"] | null {
  const lower = filePath.toLowerCase()
  if (lower.endsWith(".sql.gz")) return "sql.gz"
  if (lower.endsWith(".sql")) return "sql"
  if (lower.endsWith(".dump") || lower.endsWith(".backup")) return "pg_dump_custom"
  return null
}

async function walk(dir: string, depth = 0): Promise<string[]> {
  if (depth > 4) return []
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await walk(full, depth + 1))
    else if (EXTENSIONS.some((ext) => full.toLowerCase().endsWith(ext))) files.push(full)
  }
  return files
}

async function fileStartsWith(filePath: string, expected: string) {
  return new Promise<boolean>((resolve) => {
    const stream = createReadStream(filePath, { encoding: "utf8", start: 0, end: 512 })
    let chunk = ""
    stream.on("data", (value) => { chunk += value })
    stream.on("error", () => resolve(false))
    stream.on("end", () => resolve(chunk.includes(expected)))
  })
}

async function validate(filePath: string, kind: Candidate["kind"]) {
  if (kind === "sql.gz") {
    await execFileAsync("gzip", ["-t", filePath], { maxBuffer: 1024 * 1024 })
    return true
  }
  if (kind === "pg_dump_custom") {
    await execFileAsync("pg_restore", ["-l", filePath], { maxBuffer: 1024 * 1024 * 5 })
    return true
  }
  return fileStartsWith(filePath, "PostgreSQL database dump")
}

async function candidates() {
  const allFiles = []
  for (const root of roots()) allFiles.push(...await walk(root))
  const uniqueFiles = Array.from(new Set(allFiles))
  const valid: Candidate[] = []
  for (const filePath of uniqueFiles) {
    const kind = kindFor(filePath)
    if (!kind) continue
    const info = await stat(filePath).catch(() => null)
    if (!info?.isFile() || info.size <= 0) continue
    const ok = await validate(filePath, kind).catch(() => false)
    if (!ok) continue
    valid.push({ path: filePath, kind, size: info.size, mtimeMs: info.mtimeMs, mtime: info.mtime.toISOString() })
  }
  return valid.sort((a, b) => b.mtimeMs - a.mtimeMs || b.size - a.size || a.path.localeCompare(b.path))
}

const listOnly = process.argv.includes("--list")
const valid = await candidates()
if (listOnly) {
  console.log(JSON.stringify({ backups: valid }, null, 2))
  process.exit(0)
}

if (!valid.length) {
  console.error("No valid backup artifacts found.")
  process.exit(1)
}

const newest = valid[0]
const sameTimestamp = valid.filter((item) => item.mtimeMs === newest.mtimeMs)
if (sameTimestamp.length > 1 && new Set(sameTimestamp.map((item) => item.size)).size > 1) {
  console.error(JSON.stringify({ error: "multiple_newest_backups_differ", candidates: sameTimestamp }, null, 2))
  process.exit(2)
}

console.log(JSON.stringify({ selected: newest, candidates: valid }, null, 2))
