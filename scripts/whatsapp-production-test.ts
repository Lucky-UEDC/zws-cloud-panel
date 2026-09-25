import "dotenv/config"
import { prisma } from "@/lib/db"
import {
  assertEvolutionConfigured,
  defaultEvolutionWebhookUrl,
  getEvolutionSettings,
  sendEvolutionText,
  testEvolutionConnection,
} from "@/lib/whatsapp/evolution"

function fail(message: string, details?: unknown): never {
  console.error(JSON.stringify({ ok: false, message, details }, null, 2))
  process.exit(1)
}

async function main() {
  const settings = await getEvolutionSettings()
  assertEvolutionConfigured(settings)

  const recipient = String(process.env.EVOLUTION_TEST_RECIPIENT || settings.testRecipient || "").trim()
  if (!recipient) fail("EVOLUTION_TEST_RECIPIENT or WhatsApp runtime testRecipient is required for pnpm test:whatsapp.")

  const webhookUrl = String(process.env.EVOLUTION_WEBHOOK_URL || settings.webhookUrl || defaultEvolutionWebhookUrl()).trim()
  if (!webhookUrl) fail("APP_URL/NEXT_PUBLIC_APP_URL or Evolution webhookUrl is required to register the WhatsApp webhook.")

  const before = await testEvolutionConnection(settings, { webhookUrl, registerWebhook: true })
  const blocking = before.checks.filter((entry) => !entry.ok && !["webhook_reachable"].includes(entry.key))
  if (blocking.length) fail("Evolution connection or webhook registration failed.", { checks: before.checks, sendInstance: before.sendInstance })

  const message = [
    "MyRDPHub WhatsApp Production Verification",
    `Timestamp: ${new Date().toISOString()}`,
    `Instance: ${before.sendInstance}`,
  ].join("\n")

  const sent = await sendEvolutionText({ to: recipient, message, linkPreview: false }).catch((error) => {
    fail("Evolution real send failed.", { error: error instanceof Error ? error.message : String(error) })
  })

  const after = await testEvolutionConnection(settings, { webhookUrl, registerWebhook: false, realSendAccepted: Boolean(sent.ok) })
  const failed = after.checks.filter((entry) => !entry.ok && !["webhook_reachable"].includes(entry.key))
  if (failed.length) fail("Evolution post-send diagnostics failed.", { checks: after.checks, sent })

  console.log(JSON.stringify({
    ok: true,
    status: "PASS",
    provider: "evolution",
    apiVersion: after.apiVersion || before.apiVersion || "unknown",
    instanceId: after.instanceId,
    sendInstance: after.sendInstance,
    webhookUrl,
    toMasked: sent.toMasked,
    messageId: sent.messageId,
    checks: after.checks,
  }, null, 2))
}

main()
  .catch((error) => fail("WhatsApp production test failed.", { error: error instanceof Error ? error.message : String(error) }))
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
    process.exit(process.exitCode ?? 0)
  })
