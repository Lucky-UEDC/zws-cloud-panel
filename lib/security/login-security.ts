import { prisma } from "@/lib/db"
import { getActiveSecurityBlocks, logSecurityEvent, type SecurityContext } from "@/lib/security/abuse"

const RECOVERABLE_LOGIN_REASONS = new Set(["captcha_abuse", "captcha_replay", "rate_limit_abuse"])
const RECOVERABLE_LOGIN_ATTACKS = new Set(["captcha_abuse", "captcha_replay", "rate_limit_abuse", "spam_flood"])

type ActiveBlock = {
  id?: string
  reason?: string | null
  attackType?: string | null
  ip?: string | null
  permanent?: boolean
}

export type LoginSecurityBlocks = {
  ipBlock: ActiveBlock | null
  deviceBlock: ActiveBlock | null
  hardIpBlock: ActiveBlock | null
  recoverableIpBlock: ActiveBlock | null
  recoverableDeviceBlock: ActiveBlock | null
}

function isRecoverableCaptchaOrRateBlock(block: ActiveBlock | null) {
  if (!block) return false
  return RECOVERABLE_LOGIN_REASONS.has(String(block.reason || "")) || RECOVERABLE_LOGIN_ATTACKS.has(String(block.attackType || ""))
}

function isRecoverableDeviceOnlyPayloadBlock(block: ActiveBlock | null) {
  if (!block) return false
  return String(block.reason || "") === "malicious_payload" || String(block.attackType || "") === "unsafe_characters"
}

export async function getActiveLoginSecurityBlocks(ctx: SecurityContext): Promise<LoginSecurityBlocks> {
  const { ipBlock, deviceBlock } = await getActiveSecurityBlocks(ctx)
  const recoverableIpBlock = isRecoverableCaptchaOrRateBlock(ipBlock) ? ipBlock : null
  const recoverableDeviceBlock = isRecoverableCaptchaOrRateBlock(deviceBlock) || isRecoverableDeviceOnlyPayloadBlock(deviceBlock) ? deviceBlock : null
  return {
    ipBlock,
    deviceBlock,
    hardIpBlock: ipBlock?.permanent && !recoverableIpBlock ? ipBlock : null,
    recoverableIpBlock,
    recoverableDeviceBlock,
  }
}

export function trustedEmergencyIps() {
  return String(process.env.ADMIN_EMERGENCY_TRUSTED_IPS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function isTrustedEmergencyIp(ip: string | null | undefined) {
  if (!ip || ip === "unknown") return false
  return trustedEmergencyIps().includes(ip)
}

export function isSecurityAuthDebugEnabled() {
  return process.env.SECURITY_AUTH_DEBUG === "1"
}

export function loginSecurityDebug(event: string, detail: Record<string, unknown>) {
  if (!isSecurityAuthDebugEnabled()) return
  console.info("[AUTH_SECURITY_DEBUG]", event, detail)
}

export async function unblockRecoverableLoginBlocks(
  ctx: SecurityContext,
  blocks: Pick<LoginSecurityBlocks, "recoverableIpBlock" | "recoverableDeviceBlock">,
  actorEmail: string,
) {
  const now = new Date()
  const [ipResult, deviceResult] = await Promise.all([
    blocks.recoverableIpBlock?.id
      ? (prisma as any).blockedIp.updateMany({
        where: { id: blocks.recoverableIpBlock.id, unblockedAt: null },
        data: { unblockedAt: now, unblockedBy: "system:verified-login" },
      }).catch(() => ({ count: 0 }))
      : Promise.resolve({ count: 0 }),
    blocks.recoverableDeviceBlock?.id
      ? (prisma as any).blockedDevice.updateMany({
        where: { id: blocks.recoverableDeviceBlock.id, unblockedAt: null },
        data: { unblockedAt: now, unblockedBy: "system:verified-login" },
      }).catch(() => ({ count: 0 }))
      : Promise.resolve({ count: 0 }),
  ])

  if (ipResult.count || deviceResult.count) {
    await logSecurityEvent(ctx, "verified_login_unblocked_soft_security_block", "info", "unblocked", {
      actorEmail,
      ipBlockId: blocks.recoverableIpBlock?.id || null,
      deviceBlockId: blocks.recoverableDeviceBlock?.id || null,
      ipUnblocked: Boolean(ipResult.count),
      deviceUnblocked: Boolean(deviceResult.count),
    })
  }
}
