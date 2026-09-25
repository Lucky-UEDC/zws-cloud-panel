import { prisma } from "@/lib/db"
import type { DeviceContext, MfaRiskLevel } from "@/lib/auth/mfa/types"

export async function logSecurityEvent(input: {
  userType: string
  userId: string
  eventType: string
  device?: DeviceContext | null
  riskLevel?: MfaRiskLevel | string
  metadata?: Record<string, unknown>
}) {
  await (prisma as any).userSecurityEvent.create({
    data: {
      userType: input.userType,
      userId: input.userId,
      eventType: input.eventType,
      ip: input.device?.ip || null,
      country: input.device?.country || null,
      city: input.device?.city || null,
      region: input.device?.region || null,
      browser: input.device?.browser || null,
      os: input.device?.os || null,
      deviceType: input.device?.deviceType || null,
      riskLevel: input.riskLevel || "low",
      metadata: (input.metadata || {}) as any,
    },
  }).catch(() => null)
}

