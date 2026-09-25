import "dotenv/config"
import { prisma } from "@/lib/db"
import { computeConsoleMode } from "@/lib/console-mode"
import { createProxmoxClient } from "@/lib/proxmox"
import { validatePanelVnc } from "@/lib/proxy-console-validation"
import { getRedisClient } from "@/lib/redis"

function argValue(name: string, fallback = "") {
  const prefixed = process.argv.find((arg) => arg.startsWith(`${name}=`))
  if (prefixed) return prefixed.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] || fallback : fallback
}

async function main() {
  const vmid = Number(argValue("--vmid", process.argv[2] || "111"))
  const nodeId = argValue("--node-id", "")
  const timeoutMs = Number(argValue("--timeout-ms", "30000"))
  const sendCtrlAltDel = process.argv.includes("--ctrl-alt-del")
  const compareDirect = process.argv.includes("--compare-direct")
  if (!Number.isInteger(vmid)) {
    console.error("Usage: pnpm tsx scripts/validate-panel-vnc.ts --vmid 111 [--node-id <id>] [--ctrl-alt-del] [--compare-direct] [--timeout-ms 30000]")
    process.exitCode = 2
    return
  }

  const vps = await prisma.vpsInstance.findFirst({
    where: {
      vmid,
      deletedAt: null,
      ...(nodeId ? { proxmoxNodeId: nodeId } : {}),
    },
    include: { proxmoxNode: true },
  })
  if (!vps?.proxmoxNode || !vps.proxmoxNodeId) throw new Error(`Managed VPS for VM ${vmid} was not found`)
  const proxmox = createProxmoxClient(vps.proxmoxNode.host, vps.proxmoxNode.tokenId, vps.proxmoxNode.tokenSecret, {
    allowInsecureTls: vps.proxmoxNode.allowInsecureTls,
  })
  const vmConfig = await proxmox.getVMConfig(vps.proxmoxNode.nodeName, vps.vmid).catch(() => null)
  const mode = computeConsoleMode({ vmConfig, targetKind: "qemu" })

  const result = await validatePanelVnc({
    node: vps.proxmoxNode,
    vps: { id: vps.id, customerId: vps.customerId, vmid: vps.vmid, proxmoxNodeId: vps.proxmoxNodeId },
    timeoutMs,
    sendCtrlAltDel,
    compareDirect,
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
    width: result.width,
    height: result.height,
    firstFrameVisible: result.firstFrameVisible,
    firstNonZeroSampleBytes: result.firstNonZeroSampleBytes,
    mouseChangedFrame: result.mouseChangedFrame,
    keyboardChangedFrame: result.keyboardChangedFrame,
    inputChangedFrame: result.inputChangedFrame,
    ctrlAltDelSent: result.ctrlAltDelSent,
    resizeRequestSent: result.resizeRequestSent,
    directProxmox: result.comparedDirect ? {
      success: result.comparedDirect.success,
      opened: result.comparedDirect.opened,
      authenticated: result.comparedDirect.authenticated,
      width: result.comparedDirect.width,
      height: result.comparedDirect.height,
      firstFrameVisible: result.comparedDirect.firstFrameVisible,
      mouseChangedFrame: result.comparedDirect.mouseChangedFrame,
      keyboardChangedFrame: result.comparedDirect.keyboardChangedFrame,
      inputChangedFrame: result.comparedDirect.inputChangedFrame,
      ctrlAltDelSent: result.comparedDirect.ctrlAltDelSent,
      resizeRequestSent: result.comparedDirect.resizeRequestSent,
      message: result.comparedDirect.message,
    } : undefined,
    message: result.message,
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
