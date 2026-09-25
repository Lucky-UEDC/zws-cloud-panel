import "dotenv/config"
import { prisma } from "@/lib/db"
import { closeWhatsAppQueues, enqueueWhatsAppMessage } from "@/lib/whatsapp/queue"
import { maskWhatsAppPhone, normalizeWhatsAppPhone } from "@/lib/whatsapp/format"

const enabled = /^(1|true|yes)$/i.test(String(process.env.WHATSAPP_OTP_INSTALL_TEST || "0"))
const timeoutMs = Number(process.env.WHATSAPP_OTP_INSTALL_TIMEOUT_MS || 120_000)
const pollMs = 2_000

function assertConfigured(name: string) {
  const value = String(process.env[name] || "").trim()
  if (!value) throw new Error(`${name} is required when WHATSAPP_OTP_INSTALL_TEST=1`)
  return value
}

async function waitForAck(messageLogId: string, label: string) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const row = await (prisma as any).whatsAppMessageLog.findUnique({ where: { id: messageLogId } }).catch(() => null)
    const status = String(row?.status || "")
    if (["whatsapp_server_ack", "delivered", "read", "played"].includes(status)) return row
    if (["failed", "abandoned"].includes(status)) throw new Error(`${label} failed: ${row?.failureReason || row?.errorMessage || status}`)
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  throw new Error(`${label} did not receive WhatsApp ACK within ${timeoutMs}ms`)
}

async function sendSmokeOtp(rawPhone: string, label: string) {
  const phone = normalizeWhatsAppPhone(rawPhone)
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const result = await enqueueWhatsAppMessage({
    to: phone,
    message: `ZWS OTP delivery test code: ${code}. No action is required.`,
    category: "authentication",
    templateKey: "auth_login_otp",
    metadata: { source: "installer_otp_smoke", label },
  }, { attempts: 1 })
  if (!result.ok || !result.messageId) throw new Error(`${label} enqueue failed: ${result.error || "missing message log"}`)
  const row = await waitForAck(String(result.messageId), label)
  console.log(`[whatsapp-otp-smoke] ${label} ACK ${row.status} ${maskWhatsAppPhone(phone)}`)
}

if (!enabled) {
  console.log("[whatsapp-otp-smoke] skipped; WHATSAPP_OTP_INSTALL_TEST is not enabled")
  process.exit(0)
}

try {
  await sendSmokeOtp(assertConfigured("WHATSAPP_OTP_TEST_IN_NUMBER"), "india")
  await sendSmokeOtp(assertConfigured("WHATSAPP_OTP_TEST_US_NUMBER"), "us")
} finally {
  await closeWhatsAppQueues()
  await prisma.$disconnect()
}
