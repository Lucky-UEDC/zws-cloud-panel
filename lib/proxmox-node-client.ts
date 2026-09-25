import { prisma } from "@/lib/db"
import { createProxmoxClient, PROXMOX_LONG_TIMEOUT_MS } from "@/lib/proxmox"

export async function getActiveProxmoxNode(nodeId?: string | null) {
  const node = nodeId
    ? await prisma.proxmoxNode.findFirst({ where: { id: nodeId, isActive: true } })
    : await prisma.proxmoxNode.findFirst({ where: { isActive: true }, orderBy: [{ status: "asc" }, { createdAt: "asc" }] })
  if (!node) throw new Error("No active Proxmox node is configured")
  return node
}

export async function getActiveProxmoxClient(nodeId?: string | null) {
  const node = await getActiveProxmoxNode(nodeId)
  return {
    node,
    client: createProxmoxClient(node.host, node.tokenId, node.tokenSecret, {
      allowInsecureTls: node.allowInsecureTls,
      timeoutMs: PROXMOX_LONG_TIMEOUT_MS,
    }),
  }
}
