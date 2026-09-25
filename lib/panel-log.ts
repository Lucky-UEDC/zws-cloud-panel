import { prisma } from "@/lib/db"
import { truncateLargeString } from "@/lib/string-safety"
import { actorTypeFromPanel, createAuditEvent } from "@/lib/audit-events"
import { publishRealtimeEvent, realtimeChannels } from "@/lib/realtime-telemetry"

export const PANEL_LOG_CATEGORIES = [
  "SYSTEM",
  "ADMIN",
  "SUPPORT",
  "CUSTOMER",
  "SECURITY",
  "BILLING",
  "PAYMENT",
  "SEO",
  "WHATSAPP",
  "AUTOMATION",
] as const

export type PanelLogCategory = (typeof PANEL_LOG_CATEGORIES)[number]
export type PanelLogLevel = "info" | "warn" | "error"

type JsonLike = Record<string, unknown> | unknown[] | string | number | boolean | null

export type PanelLogInput = {
  level?: PanelLogLevel
  category: PanelLogCategory | string
  message: string
  metadata?: JsonLike
  actorType?: "admin" | "customer" | "system" | string | null
  actorId?: string | null
  actorEmail?: string | null
  customerId?: string | null
  orderId?: string | null
  vpsInstanceId?: string | null
  paymentId?: string | null
  vmid?: number | null
}

function safeMetadata(metadata: JsonLike | undefined) {
  if (metadata === undefined || metadata === null) return {}
  try {
    return JSON.parse(truncateLargeString(JSON.stringify(metadata)) || "{}")
  } catch {
    return { value: truncateLargeString(String(metadata)) }
  }
}

export async function createPanelLog(input: PanelLogInput) {
  try {
    const row = await prisma.panelLog.create({
      data: {
        level: input.level || "info",
        category: input.category,
        message: truncateLargeString(input.message, 1000) || input.message,
        metadata: safeMetadata(input.metadata) as any,
        actorType: input.actorType || null,
        actorId: input.actorId || null,
        actorEmail: input.actorEmail || null,
        customerId: input.customerId || null,
        orderId: input.orderId || null,
        vpsInstanceId: input.vpsInstanceId || null,
        paymentId: input.paymentId || null,
        vmid: Number.isInteger(input.vmid) ? input.vmid : null,
      },
    })
    await createAuditEvent({
      eventType: `${input.category}.${input.message}`,
      severity: input.level === "error" ? "ERROR" : input.level === "warn" ? "WARNING" : "INFO",
      actorType: actorTypeFromPanel(input.actorType),
      actorId: input.actorId || null,
      actorEmail: input.actorEmail || null,
      customerId: input.customerId || null,
      orderId: input.orderId || null,
      vpsInstanceId: input.vpsInstanceId || null,
      paymentId: input.paymentId || null,
      vmid: Number.isInteger(input.vmid) ? input.vmid : null,
      targetType: input.vpsInstanceId ? "vps_instance" : input.orderId ? "order" : input.paymentId ? "payment" : "panel_log",
      targetId: input.vpsInstanceId || input.orderId || input.paymentId || row.id,
      metadata: { panelLogId: row.id, category: input.category, ...(safeMetadata(input.metadata) as Record<string, unknown>) },
      status: input.level === "error" ? "ERROR" : input.level === "warn" ? "WARNING" : "SUCCESS",
    }).catch(() => null)
    const payload = {
      id: `panel:${row.id}`,
      source: "panel",
      level: row.level,
      event: row.category,
      message: row.message,
      createdAt: row.createdAt?.toISOString ? row.createdAt.toISOString() : row.createdAt,
      metadata: row.metadata || {},
    }
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {}
    const nodeId = typeof metadata.nodeId === "string" ? metadata.nodeId : null
    if (nodeId) await publishRealtimeEvent(realtimeChannels.nodeLogs(nodeId), payload).catch(() => null)
    if (row.vpsInstanceId) await publishRealtimeEvent(realtimeChannels.vpsLogs(row.vpsInstanceId), payload).catch(() => null)
    return row
  } catch (error) {
    console.warn("[PanelLog] failed to write log", {
      category: input.category,
      message: input.message,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
