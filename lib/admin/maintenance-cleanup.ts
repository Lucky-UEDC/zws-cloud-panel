import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"

export const CLEANUP_WINDOWS = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
} as const

const TARGETS: Record<string, Array<{ model: string; label: string; dateField: string; where?: Record<string, unknown> }>> = {
  messageLogs: [
    { model: "whatsAppMessageLog", label: "WhatsApp message logs", dateField: "createdAt" },
    { model: "whatsAppLog", label: "WhatsApp logs", dateField: "createdAt" },
    { model: "whatsAppQueueLog", label: "WhatsApp queue logs", dateField: "createdAt" },
    { model: "whatsAppDeliveryLog", label: "WhatsApp delivery logs", dateField: "createdAt" },
    { model: "whatsAppErrorLog", label: "WhatsApp error logs", dateField: "createdAt" },
  ],
  webhookLogs: [
    { model: "paymentWebhookLog", label: "Payment webhook logs", dateField: "createdAt" },
    { model: "paymentWebhookEvent", label: "Payment webhook events", dateField: "createdAt" },
    { model: "webhookLog", label: "Webhook logs", dateField: "createdAt" },
    { model: "whatsAppWebhookEvent", label: "WhatsApp webhook events", dateField: "createdAt" },
  ],
  notificationLogs: [
    { model: "notificationDeliveryLog", label: "Notification delivery logs", dateField: "createdAt" },
    { model: "notificationLedger", label: "Notification ledger terminal rows", dateField: "createdAt", where: { status: { in: ["delivered", "failed", "cancelled", "skipped_duplicate", "skipped_rate_limited"] } } },
  ],
  diagnostics: [
    { model: "paymentDiagnosticRun", label: "Payment diagnostic runs", dateField: "createdAt" },
    { model: "paymentDiagnosticCheck", label: "Payment diagnostic checks", dateField: "createdAt" },
    { model: "paymentValidationRun", label: "Payment validation runs", dateField: "createdAt" },
  ],
  retryLogs: [
    { model: "paymentRetryQueue", label: "Old failed payment retries", dateField: "createdAt", where: { status: { in: ["failed", "cancelled", "expired"] } } },
  ],
  expiredSessions: [
    { model: "session", label: "Expired auth sessions", dateField: "expiresAt" },
    { model: "userLoginSession", label: "Expired login sessions", dateField: "expiresAt" },
  ],
}

const PROTECTED = new Set(["order", "customer", "vpsInstance", "invoice", "payment", "paymentAttempt", "auditLog"])

function cutoffFor(windowKey: keyof typeof CLEANUP_WINDOWS, now = new Date()) {
  return new Date(now.getTime() - CLEANUP_WINDOWS[windowKey] * 24 * 60 * 60 * 1000)
}

function selectedTargets(input: unknown) {
  const requested = Array.isArray(input) ? input.map(String) : []
  const keys = requested.length ? requested : Object.keys(TARGETS)
  return keys.filter((key) => TARGETS[key])
}

export async function runMaintenanceCleanup(input: {
  window: keyof typeof CLEANUP_WINDOWS
  targets?: string[]
  mode?: "archive" | "delete"
  dryRun?: boolean
  actor?: string
}) {
  const cutoff = cutoffFor(input.window)
  const mode = input.mode === "delete" ? "delete" : "archive"
  const dryRun = input.dryRun !== false
  const summary: Array<{ target: string; model: string; count: number; action: string }> = []

  for (const target of selectedTargets(input.targets)) {
    for (const row of TARGETS[target]) {
      if (PROTECTED.has(row.model)) throw new Error(`Protected cleanup model refused: ${row.model}`)
      const model = (prisma as any)[row.model]
      if (!model?.count || !model?.deleteMany || !model?.updateMany) {
        summary.push({ target, model: row.model, count: 0, action: "model_unavailable" })
        continue
      }
      const where = { ...(row.where || {}), [row.dateField]: { lt: cutoff } }
      const count = await model.count({ where }).catch(() => 0)
      if (!dryRun && count > 0) {
        if (mode === "archive") {
          await model.updateMany({
            where,
            data: { metadata: { archivedByMaintenanceAt: new Date().toISOString(), actor: input.actor || "admin" } },
          }).catch(() => null)
        } else {
          await model.deleteMany({ where })
        }
      }
      summary.push({ target, model: row.model, count, action: dryRun ? "dry_run" : mode })
    }
  }

  await createPanelLog({
    category: "System",
    level: dryRun ? "info" : "warn",
    message: "maintenance_cleanup",
    actorType: "admin",
    metadata: { window: input.window, cutoff: cutoff.toISOString(), mode, dryRun, summary },
  }).catch(() => null)

  return { ok: true, dryRun, mode, window: input.window, cutoff: cutoff.toISOString(), summary }
}
