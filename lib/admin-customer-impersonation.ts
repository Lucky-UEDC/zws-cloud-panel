import crypto from "node:crypto"
import { prisma } from "@/lib/db"
import { writeAuditLog } from "@/lib/audit-log"
import { createPanelLog } from "@/lib/panel-log"

const TOKEN_BYTES = 32
export const ADMIN_CUSTOMER_IMPERSONATION_TTL_MS = 2 * 60 * 1000

export function hashImpersonationToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex")
}

export async function createAdminCustomerImpersonationToken(input: {
  adminId: string
  adminEmail: string
  customerId: string
  ipAddress?: string | null
  userAgent?: string | null
}) {
  const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url")
  const expiresAt = new Date(Date.now() + ADMIN_CUSTOMER_IMPERSONATION_TTL_MS)
  const row = await prisma.adminCustomerImpersonationToken.create({
    data: {
      tokenHash: hashImpersonationToken(token),
      adminId: input.adminId,
      customerId: input.customerId,
      expiresAt,
      createdIp: input.ipAddress || null,
      userAgent: input.userAgent || null,
      metadata: { createdBy: input.adminEmail } as any,
    },
  })

  await writeAuditLog({
    action: "CUSTOMER_IMPERSONATION_TOKEN_CREATED",
    adminId: input.adminId,
    actorEmail: input.adminEmail,
    customerId: input.customerId,
    targetType: "customer",
    targetId: input.customerId,
    metadata: { impersonationTokenId: row.id, expiresAt: expiresAt.toISOString() },
    ipAddress: input.ipAddress || null,
    userAgent: input.userAgent || null,
  }).catch(() => null)

  await createPanelLog({
    category: "Security",
    message: "customer_impersonation_token_created",
    actorType: "admin",
    actorId: input.adminId,
    actorEmail: input.adminEmail,
    customerId: input.customerId,
    metadata: { impersonationTokenId: row.id, expiresAt: expiresAt.toISOString() },
  }).catch(() => null)

  return { token, expiresAt, id: row.id }
}

export async function consumeAdminCustomerImpersonationToken(input: {
  token: string
  ipAddress?: string | null
  userAgent?: string | null
}) {
  const tokenHash = hashImpersonationToken(input.token)
  const now = new Date()

  return prisma.$transaction(async (tx) => {
    const row = await tx.adminCustomerImpersonationToken.findUnique({
      where: { tokenHash },
      include: {
        admin: { select: { id: true, email: true, isActive: true } },
        customer: { select: { id: true, email: true, name: true, status: true, isActive: true } },
      },
    })
    if (!row) return { ok: false as const, reason: "not_found" as const }
    if (row.consumedAt) return { ok: false as const, reason: "used" as const, row }
    if (row.expiresAt.getTime() <= now.getTime()) return { ok: false as const, reason: "expired" as const, row }
    if (!row.admin?.isActive) return { ok: false as const, reason: "admin_disabled" as const, row }
    if (!row.customer?.isActive || ["BANNED", "CLOSED"].includes(String(row.customer.status || "").toUpperCase())) {
      return { ok: false as const, reason: "customer_disabled" as const, row }
    }

    const consumed = await tx.adminCustomerImpersonationToken.update({
      where: { id: row.id },
      data: {
        consumedAt: now,
        consumedIp: input.ipAddress || null,
        userAgent: input.userAgent || row.userAgent || null,
        metadata: {
          ...((row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)) ? row.metadata as Record<string, unknown> : {}),
          consumedAt: now.toISOString(),
        } as any,
      },
    })

    await tx.auditLog.create({
      data: {
        adminId: row.adminId,
        actorEmail: row.admin.email,
        customerId: row.customerId,
        targetType: "customer",
        targetId: row.customerId,
        action: "CUSTOMER_IMPERSONATION_TOKEN_CONSUMED",
        metadata: { impersonationTokenId: row.id } as any,
        ipAddress: input.ipAddress || null,
        userAgent: input.userAgent || null,
      },
    }).catch(() => null)

    return { ok: true as const, row: consumed, admin: row.admin, customer: row.customer }
  })
}
