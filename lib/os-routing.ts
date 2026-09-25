import { prisma } from "@/lib/db"
import { assignableIpPoolStatus } from "@/lib/ip-pool"
import { isWindowsOsTemplate, resolvedOsTemplateFamily, serializeAvailableOsTemplate } from "@/lib/os-template-availability"
import { cachedJson, invalidateCachedJson } from "@/lib/runtime-cache"

export const LINUX_TEMPLATE_FAMILIES = new Set(["ubuntu", "debian", "almalinux", "alma", "rocky", "rockylinux", "centos", "linux"])

export type OsKind = "windows" | "linux" | "unknown"

export function osKindFromTemplate(template: unknown): OsKind {
  if (isWindowsOsTemplate(template)) return "windows"
  const family = resolvedOsTemplateFamily(template).toLowerCase()
  if (LINUX_TEMPLATE_FAMILIES.has(family)) return "linux"
  return family ? "linux" : "unknown"
}

export function osKindFromText(input: unknown): OsKind {
  const text = String(input || "").toLowerCase()
  if (/\b(windows|winserver|win\s*server|server\s*20\d{2}|win\d+)/.test(text)) return "windows"
  if (/\b(ubuntu|debian|alma\s*linux|almalinux|rocky\s*linux|rockylinux|centos|linux)\b/.test(text)) return "linux"
  return "unknown"
}

export function nodeProvisioningModeSupportsKind(mode: unknown, kind: OsKind) {
  return true
}

export function templateAllowedByNodeMode(template: unknown, mode: unknown) {
  return nodeProvisioningModeSupportsKind(mode, osKindFromTemplate(template))
}

function sameTemplateFamilyVersion(left: any, right: any) {
  const leftPublic = serializeAvailableOsTemplate(left)
  const rightPublic = serializeAvailableOsTemplate(right)
  return (
    resolvedOsTemplateFamily(left) === resolvedOsTemplateFamily(right) &&
    String(leftPublic.version || "").trim().toLowerCase() === String(rightPublic.version || "").trim().toLowerCase()
  )
}

export async function resolveTemplateFamilyVersion(templateId?: string | null) {
  if (!templateId) return null
  const template = await prisma.osTemplate.findUnique({ where: { id: templateId }, include: { proxmoxNode: true } }).catch(() => null)
  if (!template) return null
  const serialized = serializeAvailableOsTemplate(template)
  return {
    template,
    kind: osKindFromTemplate(template),
    family: resolvedOsTemplateFamily(template),
    version: String(serialized.version || template.osVersion || "").trim(),
  }
}

export async function findCompatibleTemplatesForNode(input: {
  nodeId: string
  purpose?: "provision" | "reinstall" | "checkout" | "admin"
  templateId?: string | null
}) {
  const node = await prisma.proxmoxNode.findUnique({ where: { id: input.nodeId } }).catch(() => null)
  if (!node) return []
  const requested = await resolveTemplateFamilyVersion(input.templateId)
  const rows = await prisma.osTemplate.findMany({
    where: {
      proxmoxNodeId: input.nodeId,
      isActive: true,
      source: { in: ["PROXMOX", "proxmox"] },
      syncedFromProxmox: true,
      proxmoxVmid: { not: null },
      ...(input.purpose === "reinstall" || input.purpose === "provision" ? { reinstallEnabled: { not: false } } : {}),
    },
    include: { proxmoxNode: { select: { id: true, name: true, nodeName: true, status: true, isActive: true } } },
    orderBy: [{ isDefault: "desc" }, { isRecommended: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
  })
  return rows.filter((template) => {
    if (requested && !sameTemplateFamilyVersion(template, requested.template)) return false
    return true
  })
}

export async function compatibleNodeIdsForTemplate(input: {
  templateId: string
  productId?: string | null
  requireIpCapacity?: boolean
}) {
  const requested = await resolveTemplateFamilyVersion(input.templateId)
  if (!requested) return []
  const nodes = await prisma.proxmoxNode.findMany({
    where: { isActive: true },
    select: { id: true, name: true, nodeName: true, status: true, isActive: true },
    orderBy: [{ name: "asc" }],
  })
  const rows: Array<{ node: any; reason: string; ok: boolean }> = []
  for (const node of nodes) {
    if (!["connected", "warning", "unknown"].includes(String(node.status || "unknown").toLowerCase())) {
      rows.push({ node, ok: false, reason: "Node health is failed" })
      continue
    }
    const templates = await findCompatibleTemplatesForNode({ nodeId: node.id, templateId: input.templateId, purpose: "provision" })
    if (!templates.length) {
      rows.push({ node, ok: false, reason: "Matching OS template is not available on this node" })
      continue
    }
    if (input.requireIpCapacity) {
      const ip = await assignableIpPoolStatus({ proxmoxNodeId: node.id, productId: input.productId || null, allocationType: "default" }).catch((error: any) => ({ ok: false, reason: error?.message || "IP pool check failed" }))
      if (!ip.ok) {
        rows.push({ node, ok: false, reason: ip.reason || "No compatible IP pool" })
        continue
      }
    }
    rows.push({ node, ok: true, reason: "Compatible" })
  }
  return rows
}

export async function getCachedRoutingCompatibility(input: {
  nodeId?: string | null
  templateId?: string | null
  productId?: string | null
  purpose?: "provision" | "reinstall" | "checkout" | "admin"
}) {
  const cacheKey = ["routing:compat", input.nodeId || "any", input.templateId || "any", input.productId || "any", input.purpose || "admin"].join(":")
  return cachedJson(cacheKey, 20, async () => {
    const [templates, nodes] = await Promise.all([
      input.nodeId ? findCompatibleTemplatesForNode({ nodeId: input.nodeId, templateId: input.templateId || null, purpose: input.purpose || "admin" }) : Promise.resolve([]),
      input.templateId ? compatibleNodeIdsForTemplate({ templateId: input.templateId, productId: input.productId || null, requireIpCapacity: false }) : Promise.resolve([]),
    ])
    return {
      nodeId: input.nodeId || null,
      templateId: input.templateId || null,
      templateIds: templates.map((template) => template.id),
      nodeIds: nodes.filter((row) => row.ok).map((row) => row.node.id),
      templates,
      nodes,
    }
  })
}

export function invalidateRoutingCompatibilityCache() {
  return invalidateCachedJson("routing:compat")
}
