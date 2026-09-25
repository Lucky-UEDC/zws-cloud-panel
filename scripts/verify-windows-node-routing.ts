import { prisma } from "@/lib/db"
import { assignableIpPoolStatus } from "@/lib/ip-pool"
import { validateProvisioningPreflight } from "@/lib/provisioning-placement"

async function main() {
  const nodeName = process.argv.slice(2).filter((arg) => arg !== "--")[0] || "platinum 1"
  const node = await prisma.proxmoxNode.findFirst({
    where: {
      OR: [
        { id: nodeName },
        { name: { equals: nodeName, mode: "insensitive" } },
        { nodeName: { equals: nodeName, mode: "insensitive" } },
      ],
    },
    include: {
      templates: { where: { isActive: true }, orderBy: [{ osFamily: "asc" }, { osVersion: "asc" }, { name: "asc" }] },
      ipPools: { where: { isActive: true } },
      storagePoolConfigs: { where: { enabled: true } },
      nodeWorker: true,
    },
  }) as any

  if (!node) {
    console.error(`[windows-routing] Node not found: ${nodeName}`)
    process.exit(1)
  }

  const windowsTemplates = node.templates.filter((template: any) => {
    const haystack = [template.name, template.slug, template.osType, template.osFamily].join(" ").toLowerCase()
    return haystack.includes("windows")
  })
  const activeStatuses = new Set(["connected", "warning", "unknown"])
  const ipPoolStatus = await assignableIpPoolStatus({ proxmoxNodeId: node.id, allocationType: "default" }).catch((error: any) => ({
    ok: false as const,
    reason: error?.message || "IP pool readiness check failed",
    pools: [],
  }))
  const summary = {
    node: { id: node.id, name: node.name, nodeName: node.nodeName, status: node.status, active: node.isActive },
    windowsTemplates: windowsTemplates.map((template: any) => ({ id: template.id, name: template.name, vmid: template.proxmoxVmid, family: template.osFamily, version: template.osVersion })),
    ipPools: (ipPoolStatus as any).pools?.map((pool: any) => ({
      id: pool.id,
      name: pool.name,
      mode: pool.poolMode,
      appliesToAllNodes: pool.appliesToAllNodes,
      cidr: pool.cidr,
      gateway: pool.gateway,
    })) || [],
    ipPoolStatus: { ok: Boolean((ipPoolStatus as any).ok), reason: (ipPoolStatus as any).reason || null, errorCode: (ipPoolStatus as any).errorCode || null },
    storagePools: node.storagePoolConfigs.map((pool: any) => ({ id: pool.id, storage: pool.storageId, enabled: pool.enabled })),
    nodeWorker: node.nodeWorker,
    checks: {
      acceptableStatus: activeStatuses.has(String(node.status || "").toLowerCase()),
      hasWindowsTemplate: windowsTemplates.length > 0,
      hasIpPool: Boolean((ipPoolStatus as any).ok),
      hasStoragePool: node.storagePoolConfigs.length > 0,
    },
  }

  console.log(JSON.stringify(summary, null, 2))

  const failed = Object.entries(summary.checks).filter(([, ok]) => !ok).map(([key]) => key)
  if (failed.length) {
    console.error(`[windows-routing] Failed checks: ${failed.join(", ")}`)
    process.exit(1)
  }

  const firstTemplate = windowsTemplates[0]
  const preflight = await validateProvisioningPreflight({
    vcpu: 2,
    ramGb: 4,
    storageGb: Number(firstTemplate.diskGb || 40),
    productId: null,
    osTemplateId: firstTemplate.id,
    nodeId: node.id,
  })
  if (!preflight.ok) {
    console.error(JSON.stringify({ preflightOk: false, reason: preflight.reason, checks: preflight.checks, placement: preflight.placement }, null, 2))
    process.exit(1)
  }
  const placement = preflight.placement as any
  console.log(JSON.stringify({ preflightOk: true, selectedNodeId: placement.node?.id, selectedTemplateId: placement.template?.id }, null, 2))
}

main()
  .then(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect().catch(() => undefined)
    process.exit(1)
  })
