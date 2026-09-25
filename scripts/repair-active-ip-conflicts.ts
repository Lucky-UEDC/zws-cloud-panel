import "dotenv/config"
import { prisma } from "@/lib/db"
import { createProxmoxClient, PROXMOX_LONG_TIMEOUT_MS } from "@/lib/proxmox"
import { robustlyStopVm } from "@/lib/vm-power-control"
import { createAuditLog } from "@/lib/audit-log"

const apply = process.argv.includes("--apply")

function guestIps(value: any) {
  const interfaces = Array.isArray(value?.result) ? value.result : Array.isArray(value) ? value : []
  return interfaces.flatMap((item: any) => Array.isArray(item?.["ip-addresses"]) ? item["ip-addresses"].map((address: any) => String(address?.["ip-address"] || "")) : [])
}

async function main() {
  const conflicts = await prisma.$queryRaw<Array<{ ipAddress: string; count: number }>>`
    SELECT "ipAddress", count(*)::int AS count
    FROM "vps_instances"
    WHERE "deletedAt" IS NULL AND "ipAddress" IS NOT NULL AND "ipAddress" <> ''
    GROUP BY "ipAddress"
    HAVING count(*) > 1
    ORDER BY "ipAddress"
  `
  const results: any[] = []
  for (const conflict of conflicts) {
    const rows = await prisma.vpsInstance.findMany({ where: { ipAddress: conflict.ipAddress, deletedAt: null }, include: { proxmoxNode: true, order: true } })
    const observed: any[] = []
    for (const vps of rows) {
      if (!vps.proxmoxNode || !vps.vmid) continue
      const client = createProxmoxClient(vps.proxmoxNode.host, vps.proxmoxNode.tokenId, vps.proxmoxNode.tokenSecret, { allowInsecureTls: vps.proxmoxNode.allowInsecureTls, timeoutMs: PROXMOX_LONG_TIMEOUT_MS })
      const [runtime, config, agent] = await Promise.all([
        client.getVMStatus(vps.proxmoxNode.nodeName, vps.vmid).catch(() => null),
        client.getVMConfig(vps.proxmoxNode.nodeName, vps.vmid).catch(() => null),
        client.getVMGuestNetworkInterfaces(vps.proxmoxNode.nodeName, vps.vmid).catch(() => null),
      ])
      const running = String(runtime?.status || "").toLowerCase() === "running"
      const agentMatch = guestIps(agent).includes(conflict.ipAddress)
      const configMatch = String(config?.ipconfig0 || "").includes(`ip=${conflict.ipAddress}/`) || String(config?.ipconfig0 || "").includes(`ip=${conflict.ipAddress},`)
      const canonical = await prisma.vmIpAssignment.count({ where: { vpsInstanceId: vps.id, ipAddress: conflict.ipAddress, status: "active" } })
      const score = (running && agentMatch ? 1000 : 0) + (running && configMatch ? 100 : 0) + (canonical ? 20 : 0) + (configMatch ? 10 : 0)
      observed.push({ vps, client, runtimeStatus: runtime?.status || null, agentMatch, configMatch, canonical: canonical > 0, score })
    }
    observed.sort((a, b) => b.score - a.score || Number(b.vps.vmid) - Number(a.vps.vmid))
    const primary = observed[0]
    const tied = observed.filter((row) => row.score === primary?.score)
    if (!primary || primary.score < 1000 || tied.length !== 1) {
      results.push({ ipAddress: conflict.ipAddress, repaired: false, reason: "no_unique_running_guest_owner", observed: observed.map((row) => ({ vpsId: row.vps.id, vmid: row.vps.vmid, score: row.score, runtimeStatus: row.runtimeStatus, agentMatch: row.agentMatch, configMatch: row.configMatch, canonical: row.canonical })) })
      continue
    }
    const secondaries = observed.filter((row) => row.vps.id !== primary.vps.id)
    if (apply) {
      for (const secondary of secondaries) {
        await robustlyStopVm({ client: secondary.client, node: secondary.vps.proxmoxNode.nodeName, vmid: secondary.vps.vmid, graceful: true })
        await secondary.client.updateVMConfig(secondary.vps.proxmoxNode.nodeName, secondary.vps.vmid, { onboot: 0 }).catch(() => undefined)
      }
      const now = new Date()
      await prisma.$transaction(async (tx) => {
        await tx.vpsInstance.update({ where: { id: primary.vps.id }, data: { ipAddress: conflict.ipAddress } })
        await tx.ipAllocation.updateMany({ where: { ipAddress: conflict.ipAddress, releasedAt: null }, data: { vpsInstanceId: primary.vps.id, vmid: primary.vps.vmid, hostname: primary.vps.name, status: "assigned" } })
        await tx.vmIpAssignment.updateMany({ where: { ipAddress: conflict.ipAddress, status: "active" }, data: { vpsInstanceId: primary.vps.id, proxmoxNodeId: primary.vps.proxmoxNodeId, vmid: primary.vps.vmid, isPrimary: true, role: "primary" } })
        await (tx as any).ipAssignment.updateMany({ where: { assignedIp: conflict.ipAddress, status: "active" }, data: { vpsInstanceId: primary.vps.id, customerId: primary.vps.customerId, vmid: primary.vps.vmid, nodeId: primary.vps.proxmoxNodeId, nodeName: primary.vps.proxmoxNode.nodeName, hostname: primary.vps.name } })
        for (const secondary of secondaries) {
          await tx.vpsInstance.update({ where: { id: secondary.vps.id }, data: { ipAddress: null, status: "NETWORK_CONFLICT", automationPausedAt: now, suspensionReason: `IP ${conflict.ipAddress} is owned by VMID ${primary.vps.vmid}; assign a new IP before start`, lifecycleMetadata: { ...((secondary.vps.lifecycleMetadata as any) || {}), networkConflictAt: now.toISOString(), conflictedIp: conflict.ipAddress, canonicalOwnerVpsId: primary.vps.id, canonicalOwnerVmid: primary.vps.vmid } } })
          await tx.order.update({ where: { id: secondary.vps.orderId }, data: { provisioningStatus: "NETWORK_CONFLICT", provisioningError: `IP ${conflict.ipAddress} is assigned to another running VM` } })
        }
      })
      await createAuditLog({ action: "ACTIVE_IP_CONFLICT_REPAIRED", actorEmail: "system:one-order-one-vm-migration", targetType: "ip_address", targetId: conflict.ipAddress, oldValue: { owners: observed.map((row) => ({ vpsId: row.vps.id, vmid: row.vps.vmid, score: row.score })) }, newValue: { canonicalVpsId: primary.vps.id, canonicalVmid: primary.vps.vmid, quarantinedVpsIds: secondaries.map((row) => row.vps.id) } })
    }
    results.push({ ipAddress: conflict.ipAddress, repaired: apply, canonicalVpsId: primary.vps.id, canonicalVmid: primary.vps.vmid, quarantined: secondaries.map((row) => ({ vpsId: row.vps.id, vmid: row.vps.vmid })) })
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "report", conflicts: conflicts.length, results }, null, 2))
}

main().finally(async () => prisma.$disconnect())
