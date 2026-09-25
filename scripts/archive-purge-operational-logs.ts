import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { finished } from "node:stream/promises"
import { once } from "node:events"
import { createGzip } from "node:zlib"
import { join } from "node:path"
import { prisma } from "@/lib/db"

type Target = { key: string; model: string; label: string; dateField: string; where?: Record<string, unknown> }

const TARGETS: Target[] = [
  { key: "webhooks", model: "paymentWebhookLog", label: "Payment webhook logs", dateField: "createdAt" },
  { key: "webhooks", model: "paymentWebhookEvent", label: "Terminal payment webhook events", dateField: "createdAt", where: { status: { in: ["processed", "processed_failed", "invalid_signature", "signature_failed", "ignored_unmatched", "duplicate_terminal_payment"] } } },
  { key: "webhooks", model: "webhookLog", label: "Generic webhook logs", dateField: "createdAt" },
  { key: "webhooks", model: "whatsAppWebhookEvent", label: "WhatsApp webhook events", dateField: "createdAt" },
  { key: "whatsapp", model: "whatsAppMessageLog", label: "WhatsApp message logs", dateField: "createdAt", where: { status: { in: ["sent", "delivered", "read", "played", "failed", "abandoned"] } } },
  { key: "whatsapp", model: "whatsAppLog", label: "WhatsApp operational logs", dateField: "createdAt" },
  { key: "whatsapp", model: "whatsAppQueueLog", label: "WhatsApp queue logs", dateField: "createdAt" },
  { key: "whatsapp", model: "whatsAppDeliveryLog", label: "WhatsApp delivery logs", dateField: "createdAt" },
  { key: "whatsapp", model: "whatsAppErrorLog", label: "WhatsApp error logs", dateField: "createdAt" },
  { key: "whatsapp", model: "whatsAppSessionLog", label: "WhatsApp session logs", dateField: "createdAt" },
  { key: "notifications", model: "notificationDeliveryLog", label: "Notification delivery logs", dateField: "createdAt" },
  { key: "notifications", model: "notificationLedger", label: "Terminal notification ledger rows", dateField: "createdAt", where: { status: { in: ["delivered", "failed", "cancelled", "skipped_duplicate", "skipped_rate_limited"] } } },
  { key: "payments", model: "gatewayLog", label: "Gateway logs", dateField: "createdAt" },
  { key: "payments", model: "gatewayHealthLog", label: "Gateway health logs", dateField: "createdAt" },
  { key: "payments", model: "paymentDiagnosticRun", label: "Payment diagnostic runs", dateField: "createdAt" },
  { key: "payments", model: "paymentDiagnosticCheck", label: "Payment diagnostic checks", dateField: "createdAt" },
  { key: "payments", model: "paymentValidationRun", label: "Payment validation runs", dateField: "createdAt", where: { status: { in: ["passed", "failed", "cancelled"] } } },
  { key: "payments", model: "paymentRetryQueue", label: "Terminal payment retry rows", dateField: "createdAt", where: { status: { in: ["failed", "cancelled", "expired", "processed"] } } },
  { key: "provisioning", model: "provisioningTaskLog", label: "Provisioning task logs", dateField: "createdAt" },
  { key: "sessions", model: "session", label: "Expired auth sessions", dateField: "expiresAt" },
  { key: "sessions", model: "userLoginSession", label: "Expired login sessions", dateField: "expiresAt" },
]

const PROTECTED_MODELS = new Set(["customer", "order", "invoice", "payment", "paymentAttempt", "paymentTransaction", "walletTransaction", "vpsInstance", "dedicatedService", "auditLog", "panelLog"])
const SENSITIVE_KEY = /password|secret|token|authorization|credential|rawbody|payload|message|caption|phone|email|customername|customer_name/i

function arg(name: string, fallback?: string) {
  const prefix = `--${name}=`
  const entry = process.argv.find((item) => item.startsWith(prefix))
  if (entry) return entry.slice(prefix.length)
  return process.argv.includes(`--${name}`) ? "true" : fallback
}

function cutoffDate() {
  const days = Math.max(1, Number(arg("days", "30")) || 30)
  return new Date(Date.now() - days * 86400_000)
}

function selectedTargets() {
  const raw = String(arg("targets", "all") || "all")
  if (raw === "all") return TARGETS
  const wanted = new Set(raw.split(",").map((item) => item.trim()).filter(Boolean))
  return TARGETS.filter((target) => wanted.has(target.key) || wanted.has(target.model))
}

function redact(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY.test(key)) return value == null ? null : "[redacted]"
  if (typeof value === "bigint") return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((entry) => redact(entry))
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([nestedKey, nested]) => [nestedKey, redact(nested, nestedKey)]))
}

async function sha256(path: string) {
  const hash = createHash("sha256")
  const stream = createReadStream(path)
  stream.on("data", (chunk) => hash.update(chunk))
  await finished(stream)
  return hash.digest("hex")
}

async function archiveRows(model: any, where: Record<string, unknown>, file: string, batchSize: number) {
  const output = createWriteStream(file, { flags: "wx", mode: 0o600 })
  const gzip = createGzip({ level: 9 })
  gzip.pipe(output)
  let cursor: string | undefined
  let archived = 0
  for (;;) {
    const rows = await model.findMany({ where, take: batchSize, orderBy: { id: "asc" }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) })
    if (!rows.length) break
    for (const row of rows) {
      if (!gzip.write(`${JSON.stringify(redact(row))}\n`)) await once(gzip, "drain")
      archived += 1
    }
    cursor = String(rows.at(-1).id)
    if (rows.length < batchSize) break
  }
  gzip.end()
  await finished(output)
  return { archived, checksumSha256: await sha256(file) }
}

async function deleteInBatches(model: any, where: Record<string, unknown>, batchSize: number) {
  let deleted = 0
  for (;;) {
    const rows = await model.findMany({ where, select: { id: true }, take: batchSize, orderBy: { id: "asc" } })
    if (!rows.length) return deleted
    deleted += Number((await model.deleteMany({ where: { id: { in: rows.map((row: any) => row.id) } } })).count || 0)
    if (rows.length < batchSize) return deleted
  }
}

async function main() {
  const apply = arg("apply") === "true"
  const cutoff = cutoffDate()
  const batchSize = Math.max(100, Math.min(5000, Number(arg("batchSize", "1000")) || 1000))
  const archiveRoot = String(arg("archiveDir", "deployment-reports/maintenance-cleanup") || "deployment-reports/maintenance-cleanup")
  const runId = new Date().toISOString().replace(/[:.]/g, "-")
  const runDir = join(archiveRoot, `archive-${runId}`)
  await mkdir(runDir, { recursive: true, mode: 0o700 })
  const summary: Array<Record<string, unknown>> = []

  for (const target of selectedTargets()) {
    if (PROTECTED_MODELS.has(target.model)) throw new Error(`Refusing protected cleanup model: ${target.model}`)
    const model = (prisma as any)[target.model]
    if (!model?.count || !model?.findMany || !model?.deleteMany) {
      summary.push({ target: target.key, model: target.model, action: "model_unavailable", matched: 0 })
      continue
    }
    const where = { ...(target.where || {}), [target.dateField]: { lt: cutoff } }
    const matched = await model.count({ where })
    let archive: Record<string, unknown> | null = null
    let deleted = 0
    if (apply && matched) {
      const archiveFile = join(runDir, `${target.model}.ndjson.gz`)
      const written = await archiveRows(model, where, archiveFile, batchSize)
      if (written.archived !== matched) throw new Error(`Archive row count mismatch for ${target.model}: expected ${matched}, archived ${written.archived}`)
      archive = { path: archiveFile, rows: written.archived, checksumSha256: written.checksumSha256, expiresAt: new Date(Date.now() + 365 * 86400_000).toISOString(), redacted: true }
      deleted = await deleteInBatches(model, where, batchSize)
      if (deleted !== matched) throw new Error(`Purge row count mismatch for ${target.model}: expected ${matched}, deleted ${deleted}`)
    }
    summary.push({ target: target.key, model: target.model, label: target.label, cutoff: cutoff.toISOString(), matched, archived: Number((archive as any)?.rows || 0), deleted, action: apply ? "archive_verified_purge" : "dry_run", archive })
  }

  const report = { ok: true, mode: apply ? "archive_verified_purge" : "dry_run", generatedAt: new Date().toISOString(), cutoff: cutoff.toISOString(), retention: { hotDays: 30, archiveDays: 365 }, protectedModels: [...PROTECTED_MODELS], summary }
  const reportFile = join(runDir, "manifest.json")
  await writeFile(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ ...report, reportFile }, null, 2))
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect().catch(() => undefined) })
