import { prisma } from "@/lib/db"
import { createAuditEvent } from "@/lib/audit-events"

type AuditInput = {
  action: string
  adminId?: string | null
  actorEmail?: string | null
  customerId?: string | null
  targetType?: string | null
  targetId?: string | null
  oldValue?: unknown
  newValue?: unknown
  metadata?: Record<string, unknown>
  ipAddress?: string | null
  userAgent?: string | null
}

function safeString(value: unknown) {
  if (value === undefined || value === null) return null
  if (typeof value === "string") return value.slice(0, 10000)
  try {
    return JSON.stringify(value).slice(0, 10000)
  } catch {
    return String(value).slice(0, 10000)
  }
}

export async function writeAuditLog(input: AuditInput) {
  try {
    const row = await prisma.auditLog.create({
      data: {
        action: input.action,
        adminId: input.adminId || null,
        actorEmail: input.actorEmail || null,
        customerId: input.customerId || null,
        targetType: input.targetType || null,
        targetId: input.targetId || null,
        oldValue: safeString(input.oldValue),
        newValue: safeString(input.newValue),
        metadata: (input.metadata || {}) as any,
        ipAddress: input.ipAddress || null,
        userAgent: input.userAgent || null,
      },
    })
    await createAuditEvent({
      eventType: input.action,
      severity: /failed|error|denied|mismatch|critical/i.test(input.action) ? "ERROR" : "INFO",
      actorType: input.adminId || input.actorEmail ? "ADMIN" : "SYSTEM",
      actorId: input.adminId || null,
      actorEmail: input.actorEmail || null,
      customerId: input.customerId || null,
      targetType: input.targetType || null,
      targetId: input.targetId || null,
      oldValue: input.oldValue as any,
      newValue: input.newValue as any,
      metadata: { auditLogId: row.id, ...(input.metadata || {}) },
      sourceIp: input.ipAddress || null,
      userAgent: input.userAgent || null,
      status: /failed|error|denied|mismatch|critical/i.test(input.action) ? "ERROR" : "SUCCESS",
    }).catch(() => null)
    return row
  } catch (error) {
    console.warn("[AuditLog] failed to write audit log", { action: input.action, error: error instanceof Error ? error.message : String(error) })
    return null
  }
}

export const createAuditLog = writeAuditLog
