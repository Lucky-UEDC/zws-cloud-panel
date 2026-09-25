import "dotenv/config"
import { computeConsoleMode } from "@/lib/console-mode"
import { prisma } from "@/lib/db"
import { createProxmoxClient } from "@/lib/proxmox"

async function main() {
  const vmid = Number(process.argv[2])
  const node = String(process.argv[3] || "")
  if (!Number.isInteger(vmid) || !node.trim()) {
    console.error("Usage: pnpm tsx scripts/test-console-mode.ts <vmid> <node>")
    process.exitCode = 2
    return
  }

  const nodeConfig = await prisma.proxmoxNode.findFirst({
    where: { OR: [{ nodeName: node }, { id: node }, { name: node }] },
  })
  if (!nodeConfig) throw new Error("Proxmox node config not found")

  const proxmox = createProxmoxClient(nodeConfig.host, nodeConfig.tokenId, nodeConfig.tokenSecret, {
    allowInsecureTls: nodeConfig.allowInsecureTls,
  })
  const vmConfig = await proxmox.getVMConfig(nodeConfig.nodeName, vmid)
  const result = computeConsoleMode({ vmConfig })

  console.log(`display_config vga=${result.display.vga || "missing"} serial0=${result.display.serial0 || "none"}`)
  console.log(`cloud_init present=${result.display.cloudInitPresent} likelyCloudImage=${result.display.likelyCloudImage}`)
  console.log(`console_mode mode=${result.mode} defaultMode=${result.defaultMode}`)
  console.log(`switches canUseSerial=${result.switches.canUseSerial} canUseVnc=${result.switches.canUseVnc}`)
  console.log(`hint ${result.reason}`)
  console.log(JSON.stringify(result, null, 2))
}

main()
  .catch((error) => {
    console.error(`FATAL ${error?.message || error}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect?.().catch(() => undefined)
  })
