import "dotenv/config"
import { prisma } from "@/lib/db"
import { computeConsoleMode } from "@/lib/console-mode"
import { createProxmoxClient } from "@/lib/proxmox"
import { validatePanelSerial } from "@/lib/proxy-console-validation"
import { getRedisClient } from "@/lib/redis"
import { decryptSecretValue } from "@/lib/secret-crypto"

function argValue(name: string, fallback = "") {
  const prefixed = process.argv.find((arg) => arg.startsWith(`${name}=`))
  if (prefixed) return prefixed.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] || fallback : fallback
}

async function main() {
  const vmid = Number(argValue("--vmid", process.argv[2] || "144"))
  const nodeId = argValue("--node-id", "")
  const timeoutMs = Number(argValue("--timeout-ms", "30000"))
  if (!Number.isInteger(vmid)) {
    console.error("Usage: pnpm tsx scripts/validate-panel-serial.ts --vmid 144 [--node-id <id>] [--timeout-ms 30000]")
    process.exitCode = 2
    return
  }

  const vps = await prisma.vpsInstance.findFirst({
    where: {
      vmid,
      deletedAt: null,
      ...(nodeId ? { proxmoxNodeId: nodeId } : {}),
    },
    include: { proxmoxNode: true, order: { select: { adminUsername: true, passwordEncrypted: true } } },
  })
  if (!vps?.proxmoxNode || !vps.proxmoxNodeId) throw new Error(`Managed VPS for VM ${vmid} was not found`)
  const encryptedPassword = String(vps.passwordEncrypted || vps.order?.passwordEncrypted || "")
  const username = String(vps.adminUsername || vps.username || vps.order?.adminUsername || "root")
  const password = encryptedPassword ? decryptSecretValue(encryptedPassword) : ""
  const proxmox = createProxmoxClient(vps.proxmoxNode.host, vps.proxmoxNode.tokenId, vps.proxmoxNode.tokenSecret, {
    allowInsecureTls: vps.proxmoxNode.allowInsecureTls,
  })
  const vmConfig = await proxmox.getVMConfig(vps.proxmoxNode.nodeName, vps.vmid).catch(() => null)
  const mode = computeConsoleMode({ vmConfig, targetKind: "qemu" })

  const result = await validatePanelSerial({
    node: vps.proxmoxNode,
    vps: { id: vps.id, customerId: vps.customerId, vmid: vps.vmid, proxmoxNodeId: vps.proxmoxNodeId },
    timeoutMs,
    username,
    password,
  })
  console.log(JSON.stringify({
    success: result.success,
    vmid,
    node: vps.proxmoxNode.nodeName,
    display: {
      vga: mode.display.vga || "default",
      serial0: mode.display.serial0 || null,
      mode: mode.mode,
      defaultMode: mode.defaultMode,
      canUseVnc: mode.switches.canUseVnc,
      canUseSerial: mode.switches.canUseSerial,
    },
    opened: result.opened,
    authenticated: result.authenticated,
    outputReceived: result.outputReceived,
    echoReturned: result.echoReturned,
    unameReturned: result.unameReturned,
    message: result.message,
    transcript: result.transcript,
  }, null, 2))
  process.exitCode = result.success ? 0 : 1
}

main()
  .catch((error) => {
    console.error(error?.message || error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
    try {
      getRedisClient()?.disconnect()
    } catch {}
  })
