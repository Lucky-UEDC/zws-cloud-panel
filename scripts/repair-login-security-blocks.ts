import "dotenv/config"
import { prisma } from "@/lib/db"

const SYSTEM_ACTOR = "system:login-security-repair"
const RECOVERABLE_REASONS = ["captcha_abuse", "captcha_replay", "rate_limit_abuse"]
const RECOVERABLE_ATTACKS = ["captcha_abuse", "captcha_replay", "rate_limit_abuse", "spam_flood"]
const RECOVERABLE_DEVICE_PAYLOAD_REASONS = ["malicious_payload"]
const RECOVERABLE_DEVICE_PAYLOAD_ATTACKS = ["unsafe_characters"]

function activeWhere() {
  return {
    unblockedAt: null,
    OR: [
      { permanent: true },
      { blockedUntil: { gt: new Date() } },
    ],
  }
}

async function main() {
  const before = {
    ips: await (prisma as any).blockedIp.count({ where: activeWhere() }).catch(() => 0),
    devices: await (prisma as any).blockedDevice.count({ where: activeWhere() }).catch(() => 0),
  }
  const now = new Date()
  const [ipResult, deviceCaptchaResult, devicePayloadResult] = await Promise.all([
    (prisma as any).blockedIp.updateMany({
      where: {
        ...activeWhere(),
        OR: [
          { reason: { in: RECOVERABLE_REASONS } },
          { attackType: { in: RECOVERABLE_ATTACKS } },
        ],
      },
      data: { unblockedAt: now, unblockedBy: SYSTEM_ACTOR },
    }).catch(() => ({ count: 0 })),
    (prisma as any).blockedDevice.updateMany({
      where: {
        ...activeWhere(),
        OR: [
          { reason: { in: RECOVERABLE_REASONS } },
          { attackType: { in: RECOVERABLE_ATTACKS } },
        ],
      },
      data: { unblockedAt: now, unblockedBy: SYSTEM_ACTOR },
    }).catch(() => ({ count: 0 })),
    (prisma as any).blockedDevice.updateMany({
      where: {
        ...activeWhere(),
        OR: [
          { reason: { in: RECOVERABLE_DEVICE_PAYLOAD_REASONS } },
          { attackType: { in: RECOVERABLE_DEVICE_PAYLOAD_ATTACKS } },
        ],
      },
      data: { unblockedAt: now, unblockedBy: SYSTEM_ACTOR },
    }).catch(() => ({ count: 0 })),
  ])
  const after = {
    ips: await (prisma as any).blockedIp.count({ where: activeWhere() }).catch(() => 0),
    devices: await (prisma as any).blockedDevice.count({ where: activeWhere() }).catch(() => 0),
  }

  console.log(JSON.stringify({
    success: true,
    before,
    unblocked: {
      ips: ipResult.count,
      captchaOrRateDevices: deviceCaptchaResult.count,
      deviceOnlyPayloadDevices: devicePayloadResult.count,
    },
    after,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error("[repair-login-security-blocks] failed", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
