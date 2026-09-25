import { prisma } from "@/lib/db"
import { createProxmoxClient, PROXMOX_LONG_TIMEOUT_MS } from "@/lib/proxmox/client"
import { canonicalOsFamily, defaultUsernameForOs, normalizeOsTemplate, slugifyOsValue } from "@/lib/os-template-normalization"
import { syncNodeCapabilities } from "@/lib/provisioning-capabilities"

type SyncFailure = {
  nodeId: string
  nodeName: string
  reason: string
}

export type SyncResult = {
  nodesChecked: number
  templatesFound: number
  imported: number
  updated: number
  disabled?: number
  failures: SyncFailure[]
}

type SyncNodeInput = {
  id: string
  name: string
  nodeName: string
  host: string
  tokenId: string
  tokenSecret: string
  allowInsecureTls: boolean
}

function detectTypeCategory(value: string): { osType: "linux" | "windows" | "bsd" | "unknown"; category: "linux" | "windows" | "other" } {
  const low = String(value || "").toLowerCase()
  if (low.includes("win")) return { osType: "windows", category: "windows" }
  if (low.includes("freebsd") || low.includes("openbsd") || low.includes("netbsd") || low.includes("bsd")) {
    return { osType: "bsd", category: "other" }
  }
  if (
    low.includes("ubuntu") ||
    low.includes("debian") ||
    low.includes("centos") ||
    low.includes("alma") ||
    low.includes("rocky") ||
    low.includes("fedora") ||
    low.includes("alpine") ||
    low.includes("suse")
  ) {
    return { osType: "linux", category: "linux" }
  }
  return { osType: "unknown", category: "other" }
}

function parseDiskGb(vm: Record<string, any>, config: Record<string, any>) {
  const maxdisk = Number(vm?.maxdisk || 0)
  if (Number.isFinite(maxdisk) && maxdisk > 0) {
    return Number((maxdisk / 1024 / 1024 / 1024).toFixed(2))
  }
  const diskCandidates = [config?.scsi0, config?.virtio0, config?.sata0]
  for (const disk of diskCandidates) {
    const raw = String(disk || "")
    const match = raw.match(/size=(\d+(?:\.\d+)?)([GMT])/i)
    if (!match) continue
    const value = Number(match[1])
    const unit = match[2].toUpperCase()
    if (!Number.isFinite(value)) continue
    if (unit === "T") return Number((value * 1024).toFixed(2))
    if (unit === "M") return Number((value / 1024).toFixed(2))
    return Number(value.toFixed(2))
  }
  return null
}

function parseMemoryMb(vm: Record<string, any>, config: Record<string, any>) {
  const vmMem = Number(vm?.maxmem || 0)
  if (Number.isFinite(vmMem) && vmMem > 0) {
    return Math.round(vmMem / 1024 / 1024)
  }
  const cfg = Number(config?.memory || 0)
  if (Number.isFinite(cfg) && cfg > 0) return Math.round(cfg)
  return null
}

function cloudInitSupported(config: Record<string, any>) {
  const values = Object.values(config || {}).map((value) => String(value || "").toLowerCase())
  return Boolean(config?.ciuser || config?.cipassword || config?.sshkeys || config?.ipconfig0 || values.some((value) => value.includes("cloudinit") || value.includes("cloud-init")))
}

function primaryStorage(config: Record<string, any>) {
  const raw = String(config?.scsi0 || config?.virtio0 || config?.sata0 || "")
  const match = raw.match(/^([^:,]+)/)
  return match?.[1] || null
}

function toSyncPayload(node: SyncNodeInput, vm: Record<string, any>, config: Record<string, any>) {
  const vmid = Number(vm?.vmid)
  const templateName = String(vm?.name || config?.name || `template-${vmid}`)
  const normalizedOs = normalizeOsTemplate(`${templateName} ${config?.description || ""}`)
  const osFamily = canonicalOsFamily(`${templateName} ${config?.description || ""} ${config?.ostype || ""}`)
  const typeInfo = detectTypeCategory(`${config?.ostype || ""} ${templateName} ${config?.description || ""}`)
  const slug = normalizedOs.slug || slugifyOsValue(templateName) || `template-${vmid}`
  const diskGb = parseDiskGb(vm, config)
  const memoryMb = parseMemoryMb(vm, config)
  const cpu = Number(config?.cores || vm?.cpus || 0)

  return {
    vmid,
    payload: {
      name: templateName,
      slug,
      proxmoxTemplateName: templateName,
      proxmoxStatus: String(vm?.status || "unknown"),
      proxmoxNodeId: node.id,
      proxmoxVmid: vmid,
      cpu: Number.isFinite(cpu) && cpu > 0 ? Math.round(cpu) : null,
      memoryMb,
      diskGb,
      osType: String(config?.ostype || typeInfo.osType || "unknown"),
      category: typeInfo.category,
      isoPath: `${node.nodeName}/qemu/${vmid}`,
      format: "qemu-template",
      source: "PROXMOX",
      sourceType: "TEMPLATE_VM",
      sourceVmid: vmid,
      storage: primaryStorage(config),
      proxmoxStorage: primaryStorage(config),
      osFamily,
      osVersion: normalizedOs.version,
      defaultUsername: defaultUsernameForOs(osFamily),
      cloudInitSupported: cloudInitSupported(config),
      reinstallEnabled: true,
      syncedFromProxmox: true,
      lastSyncedAt: new Date(),
      proxmoxConfig: config,
      isActive: true,
    },
  }
}

export async function syncSingleNodeOperatingSystems(node: SyncNodeInput, adminEmail: string): Promise<SyncResult> {
  const result: SyncResult = {
    nodesChecked: 1,
    templatesFound: 0,
    imported: 0,
    updated: 0,
    disabled: 0,
    failures: [],
  }

  console.log("[Admin][VmTemplateSync] qemu template sync started", {
    nodeId: node.id,
    nodeName: node.nodeName,
    admin: adminEmail,
  })

  try {
    const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, {
      allowInsecureTls: node.allowInsecureTls,
      timeoutMs: PROXMOX_LONG_TIMEOUT_MS,
    })

    const qemuGuests = await client.getVMList(node.nodeName)
    const vmTemplates = (Array.isArray(qemuGuests) ? qemuGuests : []).filter((guest: any) => Number(guest?.template) === 1)
    result.templatesFound = vmTemplates.length
    const seenVmids: number[] = []

    for (const vm of vmTemplates) {
      const vmid = Number(vm?.vmid)
      if (!Number.isFinite(vmid)) continue
      seenVmids.push(vmid)
      console.log("[Admin][VmTemplateSync] VMID found", {
        nodeId: node.id,
        nodeName: node.nodeName,
        vmid,
        name: String(vm?.name || ""),
      })

      let config: Record<string, any> = {}
      try {
        config = await client.getVMConfig(node.nodeName, vmid)
        console.log("[Admin][VmTemplateSync] config fetched", {
          nodeId: node.id,
          nodeName: node.nodeName,
          vmid,
        })
      } catch (error: any) {
        result.failures.push({
          nodeId: node.id,
          nodeName: node.nodeName,
          reason: `VMID ${vmid}: ${error?.message || "config fetch failed"}`,
        })
        continue
      }

      const { payload } = toSyncPayload(node, vm as Record<string, any>, config)
      const existing = await prisma.osTemplate.findUnique({
        where: {
          proxmoxNodeId_proxmoxVmid: {
            proxmoxNodeId: node.id,
            proxmoxVmid: vmid,
          },
        },
        select: { id: true },
      })

      if (existing) {
        await prisma.osTemplate.update({
          where: { id: existing.id },
          data: payload,
        })
        result.updated += 1
        await prisma.auditLog.create({
          data: {
            actorEmail: adminEmail,
            targetType: "os_template",
            targetId: existing.id,
            action: "template_synced",
            metadata: { nodeId: node.id, nodeName: node.nodeName, vmid, action: "updated" },
          },
        }).catch(() => undefined)
        console.log("[Admin][VmTemplateSync] upsert done", {
          nodeId: node.id,
          nodeName: node.nodeName,
          vmid,
          action: "updated",
        })
      } else {
        await prisma.osTemplate.create({
          data: {
            ...payload,
            isDefault: false,
            sortOrder: 0,
          },
        })
        result.imported += 1
        await prisma.auditLog.create({
          data: {
            actorEmail: adminEmail,
            targetType: "os_template",
            targetId: null,
            action: "template_synced",
            metadata: { nodeId: node.id, nodeName: node.nodeName, vmid, action: "imported" },
          },
        }).catch(() => undefined)
        console.log("[Admin][VmTemplateSync] upsert done", {
          nodeId: node.id,
          nodeName: node.nodeName,
          vmid,
          action: "imported",
        })
      }
    }

    const disabled = await prisma.osTemplate.updateMany({
      where: {
        proxmoxNodeId: node.id,
        source: "PROXMOX",
        proxmoxVmid: { not: null, notIn: seenVmids },
        isActive: true,
      },
      data: { isActive: false, lastSyncedAt: new Date() },
    })
    result.disabled = disabled.count
    if (disabled.count) {
      await prisma.auditLog.create({
        data: {
          actorEmail: adminEmail,
          targetType: "proxmox_node",
          targetId: node.id,
          action: "template_disabled",
          metadata: { nodeId: node.id, nodeName: node.nodeName, count: disabled.count },
        },
      }).catch(() => undefined)
    }
    await syncNodeCapabilities(node.id)
  } catch (error: any) {
    result.failures.push({
      nodeId: node.id,
      nodeName: node.nodeName,
      reason: error?.message || "node sync failed",
    })
  }

  console.log("[Admin][VmTemplateSync] sync completed", {
    nodeId: node.id,
    nodeName: node.nodeName,
    templatesFound: result.templatesFound,
    imported: result.imported,
    updated: result.updated,
    disabled: result.disabled || 0,
    failures: result.failures.length,
  })

  return result
}

export async function syncOsTemplatesFromProxmox(adminEmail: string): Promise<SyncResult> {
  console.log("[Admin][VmTemplateSync] sync started", { admin: adminEmail })
  const nodes = await prisma.proxmoxNode.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      nodeName: true,
      host: true,
      tokenId: true,
      tokenSecret: true,
      allowInsecureTls: true,
    },
  })

  if (!nodes.length) {
    throw Object.assign(new Error("Add and test a node first before syncing templates."), { status: 400 })
  }

  const result: SyncResult = {
    nodesChecked: 0,
    templatesFound: 0,
    imported: 0,
    updated: 0,
    disabled: 0,
    failures: [],
  }

  for (const node of nodes) {
    const nodeResult = await syncSingleNodeOperatingSystems(node, adminEmail)
    result.nodesChecked += nodeResult.nodesChecked
    result.templatesFound += nodeResult.templatesFound
    result.imported += nodeResult.imported
    result.updated += nodeResult.updated
    result.disabled = (result.disabled || 0) + (nodeResult.disabled || 0)
    result.failures.push(...nodeResult.failures)
  }

  console.log("[Admin][VmTemplateSync] sync completed", {
    nodesChecked: result.nodesChecked,
    templatesFound: result.templatesFound,
    imported: result.imported,
    updated: result.updated,
    failures: result.failures.length,
  })

  return result
}
