import { NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { prisma } from "@/lib/db"
import { createProxmoxClient } from "@/lib/proxmox"
import { vmIdentityNotesMatch, vmIdentityTagsMatch } from "@/lib/proxmox-tags"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  try {
    const nodes = await prisma.proxmoxNode.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" } })
    const ownedRows = await prisma.vpsInstance.findMany({
      where: {
        deletedAt: null,
        proxmoxNodeId: { not: null },
        vmid: { gt: 0 },
        ownershipStatus: { notIn: ["external", "manual", "rejected"] },
        provisioningSource: { in: ["panel", "zws", "linked", "imported", "manual_delivery"] },
      },
      select: {
        id: true,
        customerId: true,
        orderId: true,
        productId: true,
        proxmoxNodeId: true,
        vmid: true,
        name: true,
        ownershipStatus: true,
        ownershipVerifiedAt: true,
      },
    })
    const ownedByNodeVmid = new Map(ownedRows.map((row) => [`${row.proxmoxNodeId}:${row.vmid}`, row]))
    const allVMs = await Promise.all(
      nodes.map(async (node: any) => {
        const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, { allowInsecureTls: node.allowInsecureTls })
        const vms = await client.getVMList(node.nodeName)
        const visible = []
        for (const vm of vms) {
          const vmid = Number(vm?.vmid || 0)
          const owned = ownedByNodeVmid.get(`${node.id}:${vmid}`)
          if (!owned) continue

          let evidence: Record<string, unknown> = { source: "database_vps_instance", status: owned.ownershipStatus }
          let verified = Boolean(owned.ownershipVerifiedAt) || String(owned.ownershipStatus || "") === "verified"
          const config = await client.getVMConfig(node.nodeName, vmid).catch(() => null)
          if (config) {
            const notes = vmIdentityNotesMatch((config as any).description, {
              orderId: owned.orderId,
              customerId: owned.customerId,
              vmUuid: owned.id,
            })
            const tags = vmIdentityTagsMatch((config as any).tags, {
              orderId: owned.orderId,
              customerId: owned.customerId,
            })
            verified = verified || notes.highConfidence || notes.mediumConfidence || tags.highConfidence || tags.mediumConfidence
            evidence = {
              source: "database_vps_instance_and_proxmox_identity",
              notes: {
                orderMatch: notes.orderMatch,
                customerMatch: notes.customerMatch,
                vmUuidMatch: notes.vmUuidMatch,
                serviceMatch: notes.serviceMatch,
                highConfidence: notes.highConfidence,
                mediumConfidence: notes.mediumConfidence,
              },
              tags: {
                orderMatch: tags.orderMatch,
                customerMatch: tags.customerMatch,
                serviceMatch: tags.serviceMatch,
                highConfidence: tags.highConfidence,
                mediumConfidence: tags.mediumConfidence,
              },
            }
          }
          if (!verified && String(owned.ownershipStatus || "") !== "panel_owned") continue
          void prisma.vpsInstance.update({
            where: { id: owned.id },
            data: {
              ownershipStatus: verified ? "verified" : "panel_owned",
              ...(verified ? { ownershipVerifiedAt: new Date() } : {}),
              ownershipEvidence: { ...evidence, checkedAt: new Date().toISOString(), nodeId: node.id, nodeName: node.nodeName, vmid },
            },
          }).catch(() => null)
          visible.push({
            ...vm,
            node: node.nodeName,
            proxmoxNodeId: node.id,
            vpsInstanceId: owned.id,
            customerId: owned.customerId,
            orderId: owned.orderId,
            ownershipStatus: verified ? "verified" : "panel_owned",
          })
        }
        return visible
      })
    )
    return NextResponse.json({ vms: allVMs.flat(), ownershipFiltered: true }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500, headers: NO_CACHE_HEADERS })
  }
}
