import { NextRequest, NextResponse } from "next/server"
import { canManageCatalog } from "@/lib/admin-rbac"
import { prisma } from "@/lib/db"
import { findCompatibleTemplatesForNode, invalidateRoutingCompatibilityCache, resolveTemplateFamilyVersion } from "@/lib/os-routing"
import { syncSingleNodeOperatingSystems } from "@/lib/os-template-sync"
import { createPanelLog } from "@/lib/panel-log"
import { revalidateProductSurfaces } from "@/lib/product-revalidation"
import { invalidateCachedJson } from "@/lib/runtime-cache"
import { getAdminFromCookies } from "@/lib/server-auth"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

async function requireAdmin() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageCatalog(admin.role)) return null
  return admin
}

function idsFromBody(body: any): string[] {
  return Array.from(new Set<string>((Array.isArray(body?.ids) ? body.ids : []).map((id: unknown) => String(id || "").trim()).filter(Boolean))).slice(0, 500)
}

async function clearTemplateReferences(ids: string[]) {
  await prisma.$transaction([
    prisma.order.updateMany({ where: { operatingSystemId: { in: ids } }, data: { operatingSystemId: null, templateVmid: null } }),
    prisma.offer.updateMany({ where: { osTemplateId: { in: ids } }, data: { osTemplateId: null } }),
    prisma.vpsInstance.updateMany({ where: { operatingSystemId: { in: ids } }, data: { operatingSystemId: null } }),
    prisma.provisioningJob.updateMany({ where: { selectedTemplateId: { in: ids } }, data: { selectedTemplateId: null } }),
  ])
}

async function invalidateTemplateSurfaces() {
  await Promise.all([
    invalidateRoutingCompatibilityCache(),
    invalidateCachedJson("routing:compat"),
    invalidateCachedJson("ipam:readiness"),
  ]).catch(() => null)
  revalidateProductSurfaces()
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })

  try {
    const body = await request.json().catch(() => ({}))
    const action = String(body.action || "").trim().toLowerCase()
    const ids = idsFromBody(body)
    if (!ids.length) return NextResponse.json({ success: false, error: "Select at least one template." }, { status: 400, headers: NO_CACHE_HEADERS })

    const templates = await prisma.osTemplate.findMany({
      where: { id: { in: ids } },
      include: { proxmoxNode: { select: { id: true, name: true, nodeName: true } } },
    })
    if (!templates.length) return NextResponse.json({ success: false, error: "Templates not found." }, { status: 404, headers: NO_CACHE_HEADERS })

    let result: any = { count: templates.length }

    if (action === "enable") {
      const updated = await prisma.osTemplate.updateMany({ where: { id: { in: ids } }, data: { isActive: true, reinstallEnabled: true } })
      result = { ...result, updated: updated.count }
    } else if (action === "disable") {
      const updated = await prisma.osTemplate.updateMany({ where: { id: { in: ids } }, data: { isActive: false, reinstallEnabled: false } })
      result = { ...result, updated: updated.count }
    } else if (action === "delete") {
      if (String(body.confirm || "").trim().toUpperCase() !== "DELETE") {
        return NextResponse.json({ success: false, error: "Type DELETE to confirm bulk template removal." }, { status: 400, headers: NO_CACHE_HEADERS })
      }
      await clearTemplateReferences(ids)
      const deleted = await prisma.osTemplate.deleteMany({ where: { id: { in: ids } } })
      result = { ...result, deleted: deleted.count }
    } else if (action === "sync") {
      const nodeIds = Array.from(new Set(templates.map((template) => template.proxmoxNodeId).filter(Boolean).map(String)))
      const syncResults = []
      for (const nodeId of nodeIds) {
        const node = await prisma.proxmoxNode.findUnique({ where: { id: nodeId } })
        if (!node) continue
        syncResults.push(await syncSingleNodeOperatingSystems({
          id: node.id,
          name: node.name,
          nodeName: node.nodeName,
          host: node.host,
          tokenId: node.tokenId,
          tokenSecret: node.tokenSecret,
          allowInsecureTls: node.allowInsecureTls,
        }, String(admin.email)).catch((error: any) => ({ nodeId, success: false, error: error?.message || "Sync failed" })))
      }
      result = { ...result, syncedNodes: syncResults.length, syncResults }
    } else if (action === "move") {
      const targetNodeId = String(body.targetNodeId || body.nodeId || "").trim()
      if (!targetNodeId) return NextResponse.json({ success: false, error: "targetNodeId is required for move." }, { status: 400, headers: NO_CACHE_HEADERS })
      const targetNode = await prisma.proxmoxNode.findUnique({ where: { id: targetNodeId } })
      if (!targetNode) return NextResponse.json({ success: false, error: "Target node not found." }, { status: 404, headers: NO_CACHE_HEADERS })
      const moved: any[] = []
      const skipped: any[] = []
      for (const template of templates) {
        const requested = await resolveTemplateFamilyVersion(template.id)
        const matches = requested ? await findCompatibleTemplatesForNode({ nodeId: targetNodeId, templateId: template.id, purpose: "provision" }) : []
        const targetTemplate = matches[0]
        if (!targetTemplate) {
          skipped.push({ id: template.id, name: template.name, reason: "Matching template does not exist on target node" })
          continue
        }
        await prisma.osTemplate.update({ where: { id: targetTemplate.id }, data: { isActive: true, reinstallEnabled: true, isRecommended: template.isRecommended } })
        await prisma.osTemplate.update({ where: { id: template.id }, data: { isActive: false, reinstallEnabled: false, isDefault: false } })
        moved.push({ fromTemplateId: template.id, toTemplateId: targetTemplate.id, targetNodeId })
      }
      result = { ...result, moved, skipped }
    } else {
      return NextResponse.json({ success: false, error: "Unsupported bulk template action." }, { status: 400, headers: NO_CACHE_HEADERS })
    }

    await invalidateTemplateSurfaces()
    await createPanelLog({
      category: "Admin Action",
      message: "os_templates_bulk_action",
      actorType: "admin",
      actorEmail: String(admin.email),
      metadata: { action, ids, result },
    }).catch(() => null)

    return NextResponse.json({ success: true, action, ...result }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Bulk template action failed" }, { status: 400, headers: NO_CACHE_HEADERS })
  }
}
