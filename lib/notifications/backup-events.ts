/**
 * Backup lifecycle notifications (backup.completed / backup.failed).
 *
 * Guarantees:
 *  - Notifications are ONLY enqueued after the Proxmox task reached a
 *    terminal state AND (for completed backups) the backup volume was
 *    verified on the storage.
 *  - Exactly one message per channel per backup: idempotency is enforced
 *    with a durable reservation in `outbound_event_delivery`
 *    (dedupeKey = backup:<backupId>:<outcome>:<channel>), so retries and
 *    concurrent finalizers cannot double-send.
 *  - Sending failures never change the backup row state (status/size are
 *    already persisted by the caller before this emitter runs).
 */

import { prisma } from "@/lib/db"
import { sendNotification } from "@/lib/notifications/service"
import { markOutboundEventDelivery, reserveOutboundEventDelivery } from "@/lib/outbound-event-delivery"
import { getSiteUrl } from "@/lib/settings/site-settings"
import { createPanelLog } from "@/lib/panel-log"
import { formatBytesDecimal } from "@/lib/format-units"

export type BackupLifecycleOutcome = "completed" | "failed"

export type BackupNotificationContext = {
  backupId: string
  outcome: BackupLifecycleOutcome
  vmid?: number | null
  vpsInstanceId: string
  customerId?: string | null
  schedule?: string | null
  destination?: string | null
  sizeBytes?: bigint | number | null
  completedAt?: Date | string | null
  errorReason?: string | null
  verification?: { passed?: boolean; reason?: string | null; volid?: string | null } | null
}

const BACKUP_EMAIL_TEMPLATES: Record<BackupLifecycleOutcome, string> = {
  completed: "backup_completed",
  failed: "backup_failed",
}

const BACKUP_WHATSAPP_TEMPLATES: Record<BackupLifecycleOutcome, string> = {
  completed: "backup_completed",
  failed: "backup_failed",
}

function sanitizeFailureReason(raw: string | null | undefined): string {
  // Never leak internal Proxmox node names, UPIDs, or full paths to customers.
  let text = String(raw || "Backup failed")
    .replace(/UPID:\s*[A-Za-z0-9:_-]+/gi, "[task id]")
    .replace(/\/var\/lib\/vz\/dump\/[^\s,]+/gi, "[archive]")
    .replace(/\s+/g, " ")
    .trim()
  if (text.length > 300) text = `${text.slice(0, 297)}...`
  return text
}

function displayVmName(input: {
  instanceName?: string | null
  hostname?: string | null
  name?: string | null
  vmid?: number | null
}) {
  return String(input.instanceName || input.hostname || input.name || `VM-${input.vmid || ""}`).trim()
}

async function loadCustomerContact(input: BackupNotificationContext) {
  const customerId = String(input.customerId || "")
  if (!customerId) return null
  const customer = await prisma.customer.findUnique({ where: { id: customerId } }).catch(() => null)
  if (!customer) return null
  return {
    id: customer.id,
    email: (customer as any).email || null,
    phone: (customer as any).phone || null,
    name: (customer as any).name || (customer as any).displayName || null,
  }
}

async function loadInstanceName(input: BackupNotificationContext) {
  const instance = await prisma.vpsInstance
    .findUnique({ where: { id: input.vpsInstanceId }, select: { name: true, instanceName: true, hostname: true } })
    .catch(() => null)
  if (!instance) return null
  return { name: instance.name, instanceName: instance.instanceName, hostname: instance.hostname }
}

function formatSize(value: bigint | number | null | undefined): string {
  if (value == null) return ""
  const n = typeof value === "bigint" ? Number(value) : Number(value)
  if (!Number.isFinite(n) || n <= 0) return ""
  return formatBytesDecimal(n)
}

function formatCompletedAt(value: Date | string | null | undefined): string {
  if (!value) return ""
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC"
}

/**
 * Enqueue backup notifications for a *terminal* backup state.
 * Must be called only after the final task state + verification stage.
 * Returns channel delivery summaries; never throws.
 */
export async function emitBackupLifecycleEvent(input: BackupNotificationContext) {
  const result: { channels: string[]; skipped: string[] } = { channels: [], skipped: [] }

  try {
    if (!input.vpsInstanceId) return result
    const [contact, instance] = await Promise.all([loadCustomerContact(input), loadInstanceName(input)])
    const email = String(contact?.email || "").trim()
    const phone = String(contact?.phone || "").trim()
    if (!contact || (!email && !phone)) return result

    // Verification is a hard gate for completion notifications: an
    // unverified backup (storage listing unavailable) must NOT claim
    // success to the customer.
    if (input.outcome === "completed" && input.verification?.passed === false) {
      await createPanelLog({
        category: "Backup",
        level: "warn",
        message: "Backup completed but notification skipped (unverified)",
        actorType: "system",
        metadata: {
          backupId: input.backupId,
          reason: input.verification?.reason || null,
        },
      }).catch(() => null)
      result.skipped.push("unverified")
      return result
    }

    const serviceName = displayVmName({ ...(instance || {}), vmid: input.vmid })
    const backupsUrl = `${(await getSiteUrl().catch(() => ""))}/client-area/backups`
    const formattedSize = formatSize(input.sizeBytes)
    const formattedAt = formatCompletedAt(input.completedAt)
    const failureReason = input.outcome === "failed" ? sanitizeFailureReason(input.errorReason) : null

    // WhatsApp template variables (dedicated defaults + system fallback).
    const waTemplateKey = BACKUP_WHATSAPP_TEMPLATES[input.outcome]
    const formattedMessage =
      input.outcome === "completed"
        ? `Hello ${contact?.name || "there"},\n\nYour backup has been completed successfully.\n\nServer: ${serviceName}\nSize: ${formattedSize || "n/a"}\nStorage: ${input.destination || "default"}\nCompleted: ${formattedAt || "now"}\n\nView backups: ${backupsUrl}`
        : `Hello ${contact?.name || "there"},\n\nYour backup could not be completed.\n\nServer: ${serviceName}\nReason: ${failureReason || "unknown error"}\n\nView backups: ${backupsUrl}`

    const dedupeSuffix = `${input.backupId}:${input.outcome}`

    // Reserve each channel first — whichever channel is already reserved is
    // skipped (durable idempotency), so concurrent/retried finalizers cannot
    // double-send.
    const channels: Array<"email" | "whatsapp"> = []
    const reservations: Record<string, { dedupeKey: string }> = {}
    for (const channel of ["email", "whatsapp"] as const) {
      if (channel === "email" && !email) continue
      if (channel === "whatsapp" && !phone) continue
      const templateKey = channel === "email" ? BACKUP_EMAIL_TEMPLATES[input.outcome] : waTemplateKey
      const reservation = await reserveOutboundEventDelivery({
        channel,
        eventType: `backup.${input.outcome}`,
        templateKey,
        customerId: String(input.customerId || "") || null,
        vpsInstanceId: input.vpsInstanceId,
        cycleKey: `backup:${input.backupId}`,
        metadata: { backupId: input.backupId, outcome: input.outcome, source: "backup_lifecycle" },
      })
      if (!reservation.reserved) {
        result.skipped.push(`${channel}:duplicate`)
        continue
      }
      channels.push(channel)
      reservations[channel] = { dedupeKey: reservation.dedupeKey }
    }

    if (channels.length === 0) return result

    const notificationInput = {
      type: "server",
      channels,
      user: {
        id: contact?.id || null,
        email: email || null,
        phone: phone || null,
        name: contact?.name || null,
      },
      data: {
        templateKey: waTemplateKey,
        serviceName,
        server_name: serviceName,
        backup_size: formattedSize,
        backupSize: formattedSize,
        backupStorage: input.destination || "default",
        storage: input.destination || "default",
        completed_at: formattedAt,
        completedAt: formattedAt,
        backup_name: `${serviceName} backup`,
        backupName: `${serviceName} backup`,
        dashboard_url: backupsUrl,
        backupUrl: backupsUrl,
        clientAreaUrl: backupsUrl,
        status: input.outcome,
        failureReason: failureReason || "",
        failure_reason: failureReason || "",
        message: formattedMessage,
        account_domain: undefined,
        backupId: input.backupId,
        vpsInstanceId: input.vpsInstanceId,
        metadata: {
          source: "backup_lifecycle",
          category: "transactional",
          dedupeKey: `${dedupeSuffix}:whatsapp`,
          vpsInstanceId: input.vpsInstanceId,
          eventStatus: `backup_${input.outcome}`,
          backupId: input.backupId,
        },
      },
    }

    const sent = await sendNotification(notificationInput as any)

    for (const channel of channels) {
      const channelResult = sent?.channels?.[channel]
      const status = channelResult?.ok
        ? String(channelResult.status || "sent")
        : channelResult?.status === "skipped"
          ? "skipped"
          : "failed"
      await markOutboundEventDelivery({
        dedupeKey: reservations[channel].dedupeKey,
        status,
        providerMessageId: channelResult?.messageId || null,
        metadata: {
          backupId: input.backupId,
          outcome: input.outcome,
          serviceName,
          sizeBytes: formattedSize,
          error: channelResult?.error || null,
        },
      }).catch(() => null)
      result.channels.push(channel)
    }
  } catch (error: any) {
    // The backup row is already finalized — never let notification failures
    // change backup state or crash the caller.
    console.error("[backup-event] notification emit failed", { backupId: input.backupId, outcome: input.outcome, error: error?.message || String(error) })
  }

  return result
}