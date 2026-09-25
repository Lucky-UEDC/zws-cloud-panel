import { prisma } from "@/lib/db"
import { truncateLargeString } from "@/lib/string-safety"

export type AuditSeverity = "INFO" | "SUCCESS" | "WARNING" | "ERROR" | "CRITICAL"
export type AuditActorType = "USER" | "ADMIN" | "SYSTEM" | "WORKER" | "API" | "WEBHOOK" | string

type JsonLike = Record<string, unknown> | unknown[] | string | number | boolean | null

export type AuditEventInput = {
  eventType: string
  severity?: AuditSeverity | string
  actorType?: AuditActorType | null
  actorId?: string | null
  actorEmail?: string | null
  targetType?: string | null
  targetId?: string | null
  vmId?: string | null
  vpsInstanceId?: string | null
  vmid?: number | null
  orderId?: string | null
  customerId?: string | null
  nodeId?: string | null
  paymentId?: string | null
  oldValue?: JsonLike
  newValue?: JsonLike
  reason?: string | null
  metadata?: JsonLike
  status?: string | null
  requestId?: string | null
  correlationId?: string | null
  sourceIp?: string | null
  country?: string | null
  userAgent?: string | null
  durationMs?: number | null
}

function safeJson(value: JsonLike | undefined) {
  if (value === undefined) return undefined
  if (value === null) return null
  try {
    return JSON.parse(truncateLargeString(JSON.stringify(value)) || "{}")
  } catch {
    return { value: truncateLargeString(String(value)) }
  }
}

export function normalizeAuditSeverity(value: unknown): AuditSeverity {
  const text = String(value || "").trim().toUpperCase()
  if (text === "WARN") return "WARNING"
  if (["INFO", "SUCCESS", "WARNING", "ERROR", "CRITICAL"].includes(text)) return text as AuditSeverity
  return "INFO"
}

export function normalizeAuditEventType(value: unknown) {
  return String(value || "system.event")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_.:-]/g, "")
    .toLowerCase() || "system.event"
}

export function actorTypeFromPanel(value: unknown): AuditActorType {
  const text = String(value || "").trim().toLowerCase()
  if (text === "admin") return "ADMIN"
  if (text === "customer" || text === "client" || text === "user") return "USER"
  if (text === "webhook") return "WEBHOOK"
  if (text === "api") return "API"
  if (text === "worker") return "WORKER"
  return text ? text.toUpperCase() : "SYSTEM"
}

export async function createAuditEvent(input: AuditEventInput) {
  try {
    return await (prisma as any).auditEvent.create({
      data: {
        eventType: normalizeAuditEventType(input.eventType),
        severity: normalizeAuditSeverity(input.severity),
        actorType: input.actorType || null,
        actorId: input.actorId || null,
        actorEmail: input.actorEmail || null,
        targetType: input.targetType || null,
        targetId: input.targetId || null,
        vmId: input.vmId || input.vpsInstanceId || null,
        vpsInstanceId: input.vpsInstanceId || input.vmId || null,
        vmid: Number.isInteger(input.vmid) ? input.vmid : null,
        orderId: input.orderId || null,
        customerId: input.customerId || null,
        nodeId: input.nodeId || null,
        paymentId: input.paymentId || null,
        oldValue: safeJson(input.oldValue as JsonLike | undefined),
        newValue: safeJson(input.newValue as JsonLike | undefined),
        reason: input.reason ? truncateLargeString(input.reason, 2000) : null,
        metadataJson: safeJson(input.metadata || {}) || {},
        status: String(input.status || "SUCCESS").toUpperCase(),
        requestId: input.requestId || null,
        correlationId: input.correlationId || input.requestId || null,
        sourceIp: input.sourceIp || null,
        country: input.country || null,
        userAgent: input.userAgent ? truncateLargeString(input.userAgent, 1000) : null,
        durationMs: Number.isInteger(input.durationMs) ? input.durationMs : null,
      },
    })
  } catch (error) {
    console.warn("[AuditEvent] failed to write audit event", {
      eventType: input.eventType,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function createAggregatedAuditEvent(input: AuditEventInput & { aggregateKey: string; windowMinutes?: number; count?: number }) {
  const windowMinutes = Math.max(1, Number(input.windowMinutes || 30))
  const since = new Date(Date.now() - windowMinutes * 60 * 1000)
  const eventType = normalizeAuditEventType(input.eventType)
  const existing = await (prisma as any).auditEvent.findFirst({
    where: {
      eventType,
      actorType: input.actorType || null,
      targetId: input.targetId || null,
      timestamp: { gte: since },
      metadataJson: { path: ["aggregateKey"], equals: input.aggregateKey },
    },
    orderBy: { timestamp: "desc" },
  }).catch(() => null)

  if (!existing) {
    return createAuditEvent({
      ...input,
      metadata: { ...((input.metadata || {}) as Record<string, unknown>), aggregateKey: input.aggregateKey, aggregateCount: input.count || 1, windowMinutes },
    })
  }

  const metadata = existing.metadataJson && typeof existing.metadataJson === "object" ? existing.metadataJson : {}
  return (prisma as any).auditEvent.update({
    where: { id: existing.id },
    data: {
      timestamp: new Date(),
      severity: normalizeAuditSeverity(input.severity || existing.severity),
      status: String(input.status || existing.status || "SUCCESS").toUpperCase(),
      reason: input.reason || existing.reason || null,
      metadataJson: {
        ...metadata,
        ...((input.metadata || {}) as Record<string, unknown>),
        aggregateKey: input.aggregateKey,
        aggregateCount: Number((metadata as any).aggregateCount || 0) + Number(input.count || 1),
        windowMinutes,
        lastAggregatedAt: new Date().toISOString(),
      },
    },
  }).catch(() => null)
}
