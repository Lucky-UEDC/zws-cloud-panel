import "dotenv/config"
import { prisma } from "@/lib/db"
import { testProxmoxConnection } from "@/app/api/admin/proxmox-nodes/helpers"
import { getEvolutionSettings, testEvolutionConnection } from "@/lib/whatsapp/evolution"

function strictEnabled() {
  if (process.env.ZWS_STARTUP_STRICT === "0") return false;
  return process.env.ZWS_STARTUP_STRICT === "1" || /^production$/i.test(String(process.env.NODE_ENV || ""))
}

async function validateEvolution() {
  const settings = await getEvolutionSettings()
  const result = await testEvolutionConnection(settings, { webhookUrl: settings.webhookUrl, registerWebhook: false })
  // Webhook reachability depends on this app already listening. Keep every
  // credential/configuration check strict, then verify reachability after boot.
  const blockingChecks = result.checks.filter((check) => !check.ok && check.key !== "webhook_reachable")
  if (blockingChecks.length || !result.apiValid || !result.instanceFound || !result.connected || !result.webhookConfigured) {
    throw new Error(`Evolution API validation failed: ${result.checks.map((check) => `${check.label}=${check.ok ? "ok" : check.message}`).join("; ")}`)
  }
  console.log("[docker-strict] Evolution API validation passed", {
    instanceId: result.instanceId,
    connected: result.connected,
    webhookConfigured: result.webhookConfigured,
  })
}

async function validateProxmox() {
  const nodes = await (prisma as any).proxmoxNode.findMany({
    where: { isActive: true },
    select: { id: true, name: true, host: true, nodeName: true, tokenId: true, tokenSecret: true, allowInsecureTls: true },
    take: 10,
  })
  if (!nodes.length) throw new Error("No active Proxmox nodes are configured.")

  for (const node of nodes) {
    await testProxmoxConnection({
      host: String(node.host || ""),
      nodeName: String(node.nodeName || ""),
      tokenId: String(node.tokenId || ""),
      tokenSecret: String(node.tokenSecret || ""),
      allowInsecureTls: Boolean(node.allowInsecureTls),
      adminEmail: "docker-startup",
      timeoutMs: Number(process.env.PROXMOX_STARTUP_TIMEOUT_MS || 15000),
    })
    console.log("[docker-strict] Proxmox node validation passed", { id: node.id, name: node.name, nodeName: node.nodeName })
  }
}

async function main() {
  if (!strictEnabled()) {
    console.log("[docker-strict] skipped; ZWS_STARTUP_STRICT is disabled")
    return
  }
  await validateEvolution()
  await validateProxmox()
}

main()
  .then(async () => {
    await prisma.$disconnect().catch(() => undefined)
    process.exit(0)
  })
  .catch(async (error) => {
    console.error("[docker-strict] startup validation failed")
    console.error(error?.message || String(error))
    await prisma.$disconnect().catch(() => undefined)
    process.exit(1)
  })
