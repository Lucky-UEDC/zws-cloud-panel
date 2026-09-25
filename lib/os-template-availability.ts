import { prisma } from "@/lib/db"
import { getOsDescription, getOsFamily } from "@/lib/os-icons"
import { defaultUsernameForOs, isWindowsTemplateName, normalizeOsFamily, normalizeOsTemplate } from "@/lib/os-template-normalization"

const FAMILY_LABELS: Record<string, string> = {
  almalinux: "AlmaLinux",
  centos: "CentOS",
  debian: "Debian",
  fedora: "Fedora",
  rocky: "Rocky Linux",
  ubuntu: "Ubuntu",
  windows: "Windows Server",
}

type AvailabilityInput = {
  purpose?: "checkout" | "offer" | "reinstall" | "provision"
  nodeId?: string | null
}

function osTemplateSearchText(row: any) {
  return [
    row?.category,
    row?.osFamily,
    row?.osType,
    row?.slug,
    row?.name,
    row?.proxmoxTemplateName,
  ].filter(Boolean).join(" ")
}

export function resolvedOsTemplateFamily(row: any) {
  const search = osTemplateSearchText(row)
  if (isWindowsTemplateName(search)) return "windows"
  return getOsFamily({
    name: row?.name,
    slug: row?.slug,
    osFamily: row?.osFamily,
    family: row?.family,
    familyLabel: row?.familyLabel,
    category: row?.category,
    proxmoxTemplateName: row?.proxmoxTemplateName,
  })
}

export function isWindowsOsTemplate(row: any) {
  const explicit = [row?.category, row?.osFamily, row?.osType, row?.type]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
  if (/\b(windows|win11|win|server)\b/.test(explicit)) return true
  return resolvedOsTemplateFamily(row) === "windows"
}

function inferVersion(row: any) {
  const dbVersion = String(row?.osVersion || row?.version || "").trim()
  if (dbVersion) return dbVersion
  const normalized = normalizeOsTemplate(String(row?.name || row?.slug || row?.proxmoxTemplateName || row?.osFamily || ""))
  return normalized.version
}

export function resolvedOsTemplateDefaultUsername(row: any) {
  const fromDb = String(row?.defaultUsername || "").trim()
  if (fromDb) return fromDb
  return isWindowsOsTemplate(row) ? "Administrator" : defaultUsernameForOs(row?.name || row?.osFamily || "")
}

function hasSupportedTemplateReference(row: any) {
  return row?.proxmoxVmid !== null && row?.proxmoxVmid !== undefined
}

function sourceIsSupported(row: any) {
  return String(row?.source || "").toLowerCase() === "proxmox" && Boolean(row?.syncedFromProxmox)
}

function nodeMatches(row: any, nodeId?: string | null) {
  if (!nodeId) return true
  return row?.proxmoxNodeId === nodeId
}

export function osTemplateUnavailableReason(row: any, input: AvailabilityInput = {}) {
  const isWindows = isWindowsOsTemplate(row)
  if (!row?.isActive) return "Template is inactive."
  if (!sourceIsSupported(row)) return "Template was not synced from Proxmox"
  if (!hasSupportedTemplateReference(row)) return "Template VMID missing on Proxmox."
  if (input.nodeId && ["provision", "reinstall"].includes(String(input.purpose || "")) && !row?.proxmoxNodeId) {
    return "Template is not assigned to this compute node"
  }
  if (!row?.proxmoxNodeId && input.nodeId) return null
  if (!nodeMatches(row, input.nodeId)) return isWindows ? "Windows template is not assigned to this node." : "Template is not available on this compute node"
  if (row?.reinstallEnabled === false) return "Template support disabled"
  if (!isWindows && row?.cloudInitSupported === false) return "Cloud-init support not detected"
  return null
}

export function isOsTemplateAvailable(row: any, input: AvailabilityInput = {}) {
  return osTemplateUnavailableReason(row, input) === null
}

export function serializeAvailableOsTemplate(template: any) {
  const family = resolvedOsTemplateFamily(template)
  const version = inferVersion(template)
  const defaultUsername = resolvedOsTemplateDefaultUsername(template)
  const familyLabel = FAMILY_LABELS[family] || normalizeOsFamily(family)
  return {
    ...template,
    family,
    familyLabel,
    version,
    osFamily: family,
    category: family === "windows" ? "windows" : template.category,
    osVersion: template.osVersion || version,
    defaultUsername,
    supported: template.reinstallEnabled !== false,
    recommended: Boolean(template.isRecommended || template.isDefault),
    eolWarningText: template.eolWarningText || null,
    familyDescription: getOsDescription(template),
  }
}

function groupPublicOperatingSystems(rows: any[]) {
  const groups = new Map<string, any[]>()
  for (const row of rows.map(serializeAvailableOsTemplate)) {
    const key = `${row.family}:${row.version}`
    groups.set(key, [...(groups.get(key) || []), row])
  }

  return Array.from(groups.values()).map((items) => {
    const sorted = [...items].sort((a, b) => {
      if (Boolean(b.recommended) !== Boolean(a.recommended)) return Number(Boolean(b.recommended)) - Number(Boolean(a.recommended))
      return String(a.name || "").localeCompare(String(b.name || ""))
    })
    const primary = sorted[0]
    const {
      proxmoxVmid: _proxmoxVmid,
      proxmoxNodeId: _proxmoxNodeId,
      proxmoxNode: _proxmoxNode,
      proxmoxTemplateName: _proxmoxTemplateName,
      proxmoxStorage: _proxmoxStorage,
      source: _source,
      syncedFromProxmox: _syncedFromProxmox,
      storage: _storage,
      ...publicPrimary
    } = primary
    return {
      ...publicPrimary,
      id: `${primary.family}:${primary.version}`,
      representativeTemplateId: primary.id,
      nodeCount: sorted.length,
    }
  })
}

const OS_TEMPLATE_SELECT = {
  id: true,
  name: true,
  slug: true,
  osType: true,
  category: true,
  isActive: true,
  osFamily: true,
  osVersion: true,
  defaultUsername: true,
  isRecommended: true,
  isDefault: true,
  eolWarningText: true,
  iconUrl: true,
  sortOrder: true,
  proxmoxVmid: true,
  proxmoxTemplateName: true,
  proxmoxNodeId: true,
  cpu: true,
  memoryMb: true,
  storage: true,
  proxmoxStorage: true,
  source: true,
  syncedFromProxmox: true,
  cloudInitSupported: true,
  reinstallEnabled: true,
  proxmoxNode: {
    select: {
      id: true,
      name: true,
      nodeName: true,
    },
  },
} as const

export async function getAvailableOsTemplates(input: AvailabilityInput = {}) {
  const templates = await prisma.osTemplate.findMany({
    where: {
      isActive: true,
      source: { in: ["PROXMOX", "proxmox"] },
      syncedFromProxmox: true,
      proxmoxVmid: { not: null },
      reinstallEnabled: { not: false },
      ...(input.nodeId ? { proxmoxNodeId: input.nodeId } : {}),
    },
    select: OS_TEMPLATE_SELECT,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  })
  const available = templates.filter((template) => isOsTemplateAvailable(template, input))
  if (!available.length) {
    const candidates = await prisma.osTemplate.findMany({
      where: {
        isActive: true,
        source: { in: ["PROXMOX", "proxmox"] },
        syncedFromProxmox: true,
      },
      select: OS_TEMPLATE_SELECT,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: 50,
    }).catch(() => [])
    const reasons = candidates.reduce((acc, candidate) => {
      const reason = osTemplateUnavailableReason(candidate, input) || "Available before final filter"
      acc[reason] = (acc[reason] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    console.warn("[os_templates_availability_empty]", {
      purpose: input.purpose || null,
      nodeId: input.nodeId || null,
      filteredCandidateCount: templates.length,
      sampledCandidateCount: candidates.length,
      reasons,
    })
  }
  return available
}

export async function getPublicOperatingSystems(input: AvailabilityInput = {}) {
  return groupPublicOperatingSystems(await getAvailableOsTemplates(input))
}

export async function resolveAvailableOsTemplate(input: AvailabilityInput & {
  id?: string | null
  family?: string | null
  version?: string | null
}) {
  const include = { proxmoxNode: true } as const
  const baseWhere = {
    isActive: true,
    source: { in: ["PROXMOX", "proxmox"] },
    syncedFromProxmox: true,
    proxmoxVmid: { not: null },
    reinstallEnabled: { not: false },
    ...(input.nodeId ? { proxmoxNodeId: input.nodeId } : {}),
  }
  if (input.id && !String(input.id).includes(":")) {
    const byId = await prisma.osTemplate.findFirst({
      where: { ...baseWhere, id: String(input.id) },
      include,
    })
    if (byId && isOsTemplateAvailable(byId, input)) return byId
  }

  const groupedParts = String(input.id || "").includes(":") ? String(input.id).split(":") : []
  const requestedFamily = input.family || groupedParts[0] || null
  const requestedVersion = input.version || groupedParts.slice(1).join(":") || null
  if (!requestedFamily || !requestedVersion) return null

  const candidates = (await prisma.osTemplate.findMany({
    where: baseWhere,
    include,
    orderBy: [{ isRecommended: "desc" }, { isDefault: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
  })).filter((template) => isOsTemplateAvailable(template, input))
  const normalizedFamily = resolvedOsTemplateFamily({
    osFamily: requestedFamily,
    name: requestedFamily,
    slug: requestedFamily,
    category: requestedFamily,
    osType: requestedFamily,
  })
  return candidates.find((template) => {
    const family = resolvedOsTemplateFamily(template)
    const version = inferVersion(template)
    return family === normalizedFamily && String(version || "").trim().toLowerCase() === String(requestedVersion || "").trim().toLowerCase()
  }) || null
}
