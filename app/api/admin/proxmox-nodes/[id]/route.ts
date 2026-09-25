import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"
import { syncSingleNodeOperatingSystems } from "@/lib/os-template-sync"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { invalidateComputeNodeCache } from "@/lib/compute-node-monitoring"
import { defaultCloneLimitForNodeClass } from "@/lib/node-workers"
import {
  boolValue,
  errorResponse,
  NO_CACHE_HEADERS,
  nodeResponse,
  requiredConnectionFields,
  testProxmoxConnection,
  textValue,
} from "../helpers"
import { normalizeProxmoxHost } from "@/lib/proxmox/client"

export const dynamic = "force-dynamic"
export const revalidate = 0

function requestHeaderDebug(request: NextRequest) {
  return {
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    host: request.headers.get("host"),
    xForwardedHost: request.headers.get("x-forwarded-host"),
    xForwardedProto: request.headers.get("x-forwarded-proto"),
    pathname: request.nextUrl.pathname,
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const { id } = await params
  try {
    const node = await prisma.proxmoxNode.findUnique({ where: { id } })
    if (!node) return NextResponse.json({ error: "Node not found" }, { status: 404, headers: NO_CACHE_HEADERS })
    const templatesCount = await prisma.osTemplate.count({
      where: {
        proxmoxNodeId: node.id,
        source: "PROXMOX",
        syncedFromProxmox: true,
        proxmoxVmid: { not: null },
        isActive: true,
      },
    })
    return NextResponse.json(nodeResponse({ ...node, templatesCount }), { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_CACHE_HEADERS })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const { id } = await params
  try {
    console.log("[Admin][ProxmoxNode] node save started", { id, admin: admin.email, request: requestHeaderDebug(request) })
    const body = await request.json()
    const existing = await prisma.proxmoxNode.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: "Node not found" }, { status: 404, headers: NO_CACHE_HEADERS })

    const missing = requiredConnectionFields(body, false)
    if (missing.length) {
      return NextResponse.json({ error: `Missing required fields: ${missing.join(", ")}` }, { status: 400, headers: NO_CACHE_HEADERS })
    }

    const tokenId = textValue(body.tokenId) || existing.tokenId
    const tokenSecret = textValue(body.tokenSecret) || existing.tokenSecret
    const allowInsecureTls = body.allowInsecureTls === undefined ? existing.allowInsecureTls : boolValue(body.allowInsecureTls)
    const nextHost = normalizeProxmoxHost(textValue(body.host))
    const nextNodeName = textValue(body.nodeName)
    // Optional SSH credentials for QEMU process kill fallback (tier 3 force stop)
    const sshUsername = body.sshUsername !== undefined ? (textValue(body.sshUsername) || null) : (existing as any).sshUsername || null
    const sshPassword = body.sshPassword !== undefined ? (textValue(body.sshPassword) || null) : (existing as any).sshPassword || null
    if (!tokenId || !tokenSecret) {
      return NextResponse.json({ error: "Missing required fields: tokenId/tokenSecret" }, { status: 400, headers: NO_CACHE_HEADERS })
    }

    console.log("[Admin][ProxmoxNode] node save payload", {
      id,
      admin: admin.email,
      oldHost: existing.host,
      newHost: nextHost,
      nodeName: nextNodeName,
      location: textValue(body.location) || null,
      allowInsecureTls,
      hasTokenId: Boolean(tokenId),
      hasTokenSecret: Boolean(tokenSecret),
    })

    const test = await testProxmoxConnection({
      host: nextHost,
      tokenId,
      tokenSecret,
      nodeName: nextNodeName,
      allowInsecureTls,
      adminEmail: String(admin.email),
    })

    const node = await prisma.proxmoxNode.update({
      where: { id },
      data: {
        name: textValue(body.name),
        host: test.host,
        tokenId,
        tokenSecret,
        nodeName: nextNodeName,
        location: textValue(body.location) || null,
        allowInsecureTls,
        sshUsername,
        sshPassword,
        resolvedIp: test.resolvedIp,
        status: "connected",
        lastCheckedAt: new Date(),
      },
      include: { nodeClass: { select: { name: true, slug: true } } },
    })
    await (prisma as any).nodeWorker.upsert({
      where: { nodeId: node.id },
      create: { nodeId: node.id, maxTasks: defaultCloneLimitForNodeClass(node.nodeClass), health: "connected" },
      update: { health: "connected" },
    }).catch(() => null)
    invalidateComputeNodeCache(node.id)

    const templatesCount = await prisma.osTemplate.count({
      where: {
        proxmoxNodeId: node.id,
        source: "PROXMOX",
        syncedFromProxmox: true,
        proxmoxVmid: { not: null },
        isActive: true,
      },
    })

    return NextResponse.json({
      node: nodeResponse({
        ...node,
        templatesCount,
      }),
    }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return errorResponse(error)
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const { id } = await params
  try {
    const node = await prisma.proxmoxNode.findUnique({ where: { id } })
    if (!node) {
      return NextResponse.json({ error: "Node not found" }, { status: 404, headers: NO_CACHE_HEADERS })
    }

    const [
      vpsInstances,
      orders,
      vmActionJobs,
      provisioningIdentities,
      duplicateVmIncidents,
      templates,
    ] = await Promise.all([
      prisma.vpsInstance.findMany({ where: { proxmoxNodeId: id, deletedAt: null }, select: { id: true, vmid: true, status: true } }),
      prisma.order.findMany({ where: { proxmoxNodeId: id, deletedAt: null }, select: { id: true, orderNumber: true, status: true } }),
      prisma.vmActionJob.findMany({ where: { proxmoxNodeId: id, completedAt: null }, select: { id: true, action: true, status: true } }),
      prisma.vmProvisioningIdentity.findMany({ where: { proxmoxNodeId: id }, select: { id: true, phase: true, vmid: true } }),
      prisma.duplicateVmIncident.findMany({ where: { proxmoxNodeId: id, deletedAt: null }, select: { id: true, vmid: true, status: true } }),
      prisma.osTemplate.findMany({ where: { proxmoxNodeId: id, isActive: true }, select: { id: true, name: true, proxmoxVmid: true } }),
    ])

    const blockers = [
      ...vpsInstances.map((vps) => `vps:${vps.vmid || vps.id} (${vps.status})`),
      ...orders.map((order) => `order:${order.orderNumber || order.id} (${order.status})`),
      ...vmActionJobs.map((job) => `vm-job:${job.action} (${job.status})`),
      ...provisioningIdentities.map((identity) => `provisioning:${identity.vmid || identity.id} (${identity.phase})`),
      ...duplicateVmIncidents.map((incident) => `duplicate-vm:${incident.vmid} (${incident.status})`),
      ...templates.map((template) => `template:${template.name || template.proxmoxVmid || template.id}`),
    ]

    if (blockers.length > 0) {
      return NextResponse.json(
        {
          error: "This node cannot be deleted while it still has active VM, order, or provisioning references.",
          blockers,
          code: "NODE_DELETE_BLOCKED",
        },
        { status: 409, headers: NO_CACHE_HEADERS }
      )
    }

    await prisma.$transaction(async (tx) => {
      await tx.nodeWorker.deleteMany({ where: { nodeId: id } }).catch(() => undefined)
      await tx.nodeLimit.deleteMany({ where: { nodeId: id } }).catch(() => undefined)
      await tx.nodeStoragePoolConfig.deleteMany({ where: { proxmoxNodeId: id } }).catch(() => undefined)
      await tx.osTemplate.updateMany({
        where: { proxmoxNodeId: id },
        data: {
          proxmoxNodeId: null,
          syncedFromProxmox: false,
          proxmoxVmid: null,
          isActive: false,
          source: "MANUAL",
        },
      })
      await tx.proxmoxNode.delete({ where: { id } })
    })

    invalidateComputeNodeCache(id)
    return NextResponse.json({ success: true }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({
      error: error.message || "Delete failed",
      code: "NODE_DELETE_FAILED",
    }, { status: 500, headers: NO_CACHE_HEADERS })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const { id } = await params
  const { action } = (await request.json()) as { action: string }

  if (action === "test") {
    try {
      const node = await prisma.proxmoxNode.findUnique({ where: { id } })
      if (!node) return NextResponse.json({ error: "Node not found" }, { status: 404, headers: NO_CACHE_HEADERS })

      const test = await testProxmoxConnection({
        host: node.host,
        tokenId: node.tokenId,
        tokenSecret: node.tokenSecret,
        nodeName: node.nodeName,
        allowInsecureTls: node.allowInsecureTls,
        adminEmail: String(admin.email),
      })

      await prisma.proxmoxNode.update({
        where: { id },
        data: { status: "connected", lastCheckedAt: new Date(), host: test.host, resolvedIp: test.resolvedIp },
      })
      invalidateComputeNodeCache(id)
      await createPanelLog({
        category: "Compute Node",
        message: "Node test successful",
        actorType: "admin",
        actorEmail: String(admin.email),
        metadata: { nodeId: id, nodeName: node.nodeName, host: node.host },
      })

      return NextResponse.json(test, { headers: NO_CACHE_HEADERS })
    } catch (error: any) {
      await prisma.proxmoxNode.update({
        where: { id },
        data: { status: "failed", lastCheckedAt: new Date() },
      }).catch(() => undefined)
      invalidateComputeNodeCache(id)
      await createPanelLog({
        category: "Compute Node",
        level: "error",
        message: /auth|permission|token/i.test(String(error?.message || "")) ? "Node test auth/permission error" : "Node test failed",
        actorType: "admin",
        actorEmail: String(admin.email),
        metadata: { nodeId: id, error: error?.message || "Connection failed", status: error?.status || null },
      })
      return errorResponse(error)
    }
  }

  if (action === "syncTemplates") {
    try {
      const node = await prisma.proxmoxNode.findUnique({ where: { id } })
      if (!node) return NextResponse.json({ error: "Node not found" }, { status: 404, headers: NO_CACHE_HEADERS })

      const sync = await syncSingleNodeOperatingSystems(
        {
          id: node.id,
          name: node.name,
          nodeName: node.nodeName,
          host: node.host,
          tokenId: node.tokenId,
          tokenSecret: node.tokenSecret,
          allowInsecureTls: node.allowInsecureTls,
        },
        String(admin.email)
      )
      await createPanelLog({
        category: "Compute Node",
        message: "Template sync successful",
        actorType: "admin",
        actorEmail: String(admin.email),
        metadata: { nodeId: id, nodeName: node.nodeName, host: node.host, sync },
      })

      return NextResponse.json({ success: true, sync }, { headers: NO_CACHE_HEADERS })
    } catch (error: any) {
      await createPanelLog({
        category: "Compute Node",
        level: "error",
        message: "Template sync failed",
        actorType: "admin",
        actorEmail: String(admin.email),
        metadata: { nodeId: id, error: error?.message || "Template sync failed", status: error?.status || null },
      })
      return errorResponse(error)
    }
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400, headers: NO_CACHE_HEADERS })
}
