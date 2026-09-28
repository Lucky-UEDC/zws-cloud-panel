import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { createProxmoxClient, PROXMOX_LONG_TIMEOUT_MS } from "@/lib/proxmox"
import { serializeOperatingSystem } from "@/app/api/admin/os-templates/serializers"
import { syncSingleNodeOperatingSystems } from "@/lib/os-template-sync"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

async function requireAdmin() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return null
  return admin
}

function text(value: unknown) {
  return String(value || "").trim()
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function boolOrCurrent(value: unknown, current: boolean) {
  return value === undefined ? current : Boolean(value)
}

function primaryStorage(config: Record<string, any>) {
  const raw = String(config?.scsi0 || config?.virtio0 || config?.sata0 || config?.ide0 || "")
  const match = raw.match(/^([^:,]+)/)
  return match?.[1] || null
}

function diskGbFromConfig(config: Record<string, any>) {
  for (const disk of [config?.scsi0, config?.virtio0, config?.sata0, config?.ide0]) {
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

function cloudInitSupported(config: Record<string, any>) {
  const values = Object.values(config || {}).map((value) => String(value || "").toLowerCase())
  return Boolean(config?.ciuser || config?.cipassword || config?.sshkeys || config?.ipconfig0 || values.some((value) => value.includes("cloudinit") || value.includes("cloud-init")))
}

function proxmoxVmUrl(host: string, nodeName: string, vmid: number | null) {
  if (!vmid) return host
  const base = host.replace(/\/+$/, "")
  return `${base}/#v1:0:=qemu%2F${vmid}:4::::::${encodeURIComponent(nodeName)}`
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; templateId: string }> }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  const { id, templateId } = await params
  const body = await request.json().catch(() => ({}))
  const action = text(body.action).toLowerCase()
  const node = await prisma.proxmoxNode.findUnique({ where: { id } })
  if (!node) return NextResponse.json({ success: false, error: "Node not found" }, { status: 404, headers: NO_CACHE_HEADERS })

  if (action === "refresh" || action === "sync") {
    const sync = await syncSingleNodeOperatingSystems({
      id: node.id,
      name: node.name,
      nodeName: node.nodeName,
      host: node.host,
      tokenId: node.tokenId,
      tokenSecret: node.tokenSecret,
      allowInsecureTls: node.allowInsecureTls,
    }, String(admin.email))
    return NextResponse.json({ success: true, action, nodeId: id, sync, refreshedAt: new Date().toISOString() }, { headers: NO_CACHE_HEADERS })
  }

  const template = await prisma.osTemplate.findFirst({
    where: { id: templateId, proxmoxNodeId: id },
    include: { proxmoxNode: { select: { id: true, name: true, nodeName: true } } },
  })
  if (!template) return NextResponse.json({ success: false, error: "Template not found on this node" }, { status: 404, headers: NO_CACHE_HEADERS })

  let updated: any = template
  if (action === "enable") {
    updated = await prisma.osTemplate.update({ where: { id: template.id }, data: { isActive: true, reinstallEnabled: true } })
  } else if (action === "disable") {
    updated = await prisma.osTemplate.update({ where: { id: template.id }, data: { isActive: false, reinstallEnabled: false } })
  } else if (action === "set_default") {
    await prisma.osTemplate.updateMany({ where: { proxmoxNodeId: id, id: { not: template.id } }, data: { isDefault: false } })
    updated = await prisma.osTemplate.update({ where: { id: template.id }, data: { isDefault: true, isActive: true, reinstallEnabled: true } })
  } else if (action === "edit_metadata") {
    const name = text(body.name) || template.name
    const osFamily = text(body.osFamily) || template.osFamily
    const osVersion = text(body.osVersion) || template.osVersion
    const osType = text(body.osType) || template.osType
    const storage = text(body.storage || body.proxmoxStorage) || template.proxmoxStorage || template.storage
    updated = await prisma.osTemplate.update({
      where: { id: template.id },
      data: {
        name,
        proxmoxTemplateName: name,
        osFamily,
        osVersion,
        osType,
        proxmoxStorage: storage,
        storage,
        diskGb: numberOrNull(body.diskGb) ?? template.diskGb,
        cloudInitSupported: boolOrCurrent(body.cloudInitSupported, template.cloudInitSupported),
        reinstallEnabled: boolOrCurrent(body.reinstallEnabled, template.reinstallEnabled),
        isActive: boolOrCurrent(body.isActive, template.isActive),
        lastSyncedAt: new Date(),
      },
    })
  } else if (action === "delete") {
    if (String(body.confirm || "").toLowerCase() !== "delete") {
      return NextResponse.json({ success: false, error: "Type delete to confirm template removal." }, { status: 400, headers: NO_CACHE_HEADERS })
    }
    await prisma.osTemplate.delete({ where: { id: template.id } })
    await createPanelLog({
      category: "Compute Node",
      message: "node_template_deleted",
      actorType: "admin",
      actorEmail: String(admin.email),
      metadata: { nodeId: id, templateId: template.id, vmid: template.proxmoxVmid },
    }).catch(() => null)
    return NextResponse.json({ success: true, action, nodeId: id, template: null, refreshedAt: new Date().toISOString() }, { headers: NO_CACHE_HEADERS })
  } else if (action === "clone") {
    const sourceVmid = Number(template.proxmoxVmid || 0)
    const newVmid = Number(body.newVmid || body.vmid || 0)
    const name = text(body.name || body.templateName || `${template.name}-copy`)
    if (!sourceVmid || !newVmid || !name) {
      return NextResponse.json({ success: false, error: "Clone requires source VMID, newVmid, and name." }, { status: 400, headers: NO_CACHE_HEADERS })
    }
    const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, {
      allowInsecureTls: node.allowInsecureTls,
      timeoutMs: PROXMOX_LONG_TIMEOUT_MS,
    })
    const result = await client.cloneVM(node.nodeName, sourceVmid, newVmid, name, {
      full: 1,
      storage: text(body.storage) || template.proxmoxStorage || undefined,
    })
    await createPanelLog({
      category: "Compute Node",
      message: "node_template_clone_started",
      actorType: "admin",
      actorEmail: String(admin.email),
      metadata: { nodeId: id, templateId: template.id, sourceVmid, newVmid, name, result },
    }).catch(() => null)
    return NextResponse.json({ success: true, action, nodeId: id, template: serializeOperatingSystem(template), result, refreshedAt: new Date().toISOString() }, { headers: NO_CACHE_HEADERS })
  } else if (action === "verify_guest_agent") {
    // Replaces "rebuild cloudinit".
    //
    // Regenerating a cloud-init disk prepared a guest the platform no longer
    // configures that way. What a template actually needs now is a working
    // QEMU Guest Agent channel, because that is the only channel guest
    // automation uses. A template VM is not running, so all that can be checked
    // from the host is that the channel is enabled; whether the agent is really
    // installed inside the image is proven on the first clone, not asserted here.
    const vmid = Number(template.proxmoxVmid || 0)
    if (!vmid) return NextResponse.json({ success: false, error: "Template VMID is required." }, { status: 400, headers: NO_CACHE_HEADERS })
    if (text(body.confirm).toLowerCase() !== "verify") {
      return NextResponse.json({ success: false, error: "Type verify to confirm the guest agent check." }, { status: 400, headers: NO_CACHE_HEADERS })
    }
    const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, {
      allowInsecureTls: node.allowInsecureTls,
      timeoutMs: PROXMOX_LONG_TIMEOUT_MS,
    })
    const config = await client.getVMConfig(node.nodeName, vmid).catch(() => null)
    const agentChannelEnabled = config
      ? Object.entries(config).some(([key, value]) => /^agent(\d+)?$/i.test(key) && Number(value) === 1)
      : false
    if (config && !agentChannelEnabled) {
      await client.updateVMConfig(node.nodeName, vmid, { agent: "1" }).catch(() => null)
    }
    const refreshed = config && !agentChannelEnabled ? await client.getVMConfig(node.nodeName, vmid).catch(() => config) : config
    const result = {
      vmid,
      agentChannelEnabledBefore: agentChannelEnabled,
      agentChannelEnabledAfter: refreshed
        ? Object.entries(refreshed).some(([key, value]) => /^agent(\d+)?$/i.test(key) && Number(value) === 1)
        : false,
      note: "Guest automation configures the guest through qm guest; the QEMU guest agent must be installed inside the image.",
    }
    updated = await prisma.osTemplate.update({
      where: { id: template.id },
      data: {
        proxmoxConfig: refreshed || template.proxmoxConfig || undefined,
        lastSyncedAt: new Date(),
      },
    })
    await createPanelLog({
      category: "Compute Node",
      message: "node_template_guest_agent_verified",
      actorType: "admin",
      actorEmail: String(admin.email),
      metadata: { nodeId: id, templateId: template.id, ...result },
    }).catch(() => null)
  } else if (action === "refresh_storage_mapping") {
    const vmid = Number(template.proxmoxVmid || 0)
    if (!vmid) return NextResponse.json({ success: false, error: "Template VMID is required to refresh storage mapping." }, { status: 400, headers: NO_CACHE_HEADERS })
    if (text(body.confirm).toLowerCase() !== "refresh") {
      return NextResponse.json({ success: false, error: "Type refresh to confirm storage mapping refresh." }, { status: 400, headers: NO_CACHE_HEADERS })
    }
    const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, {
      allowInsecureTls: node.allowInsecureTls,
      timeoutMs: PROXMOX_LONG_TIMEOUT_MS,
    })
    const config = await client.getVMConfig(node.nodeName, vmid)
    const storage = primaryStorage(config) || template.proxmoxStorage || template.storage
    updated = await prisma.osTemplate.update({
      where: { id: template.id },
      data: {
        proxmoxConfig: config,
        proxmoxStorage: storage,
        storage,
        diskGb: diskGbFromConfig(config) ?? template.diskGb,
        cloudInitSupported: cloudInitSupported(config),
        lastSyncedAt: new Date(),
      },
    })
    await createPanelLog({
      category: "Compute Node",
      message: "node_template_storage_mapping_refreshed",
      actorType: "admin",
      actorEmail: String(admin.email),
      metadata: { nodeId: id, templateId: template.id, vmid, storage },
    }).catch(() => null)
  } else if (action === "open_proxmox") {
    return NextResponse.json({
      success: true,
      action,
      nodeId: id,
      url: proxmoxVmUrl(node.host, node.nodeName, template.proxmoxVmid),
      refreshedAt: new Date().toISOString(),
    }, { headers: NO_CACHE_HEADERS })
  } else {
    return NextResponse.json({ success: false, error: "Unsupported template action" }, { status: 400, headers: NO_CACHE_HEADERS })
  }

  await createPanelLog({
    category: "Compute Node",
    message: `node_template_${action}`,
    actorType: "admin",
    actorEmail: String(admin.email),
    metadata: { nodeId: id, templateId: template.id, vmid: template.proxmoxVmid },
  }).catch(() => null)
  const fresh = await prisma.osTemplate.findUnique({
    where: { id: updated.id },
    include: { proxmoxNode: { select: { id: true, name: true, nodeName: true } } },
  })
  return NextResponse.json({ success: true, action, nodeId: id, template: fresh ? serializeOperatingSystem(fresh) : null, refreshedAt: new Date().toISOString() }, { headers: NO_CACHE_HEADERS })
}
