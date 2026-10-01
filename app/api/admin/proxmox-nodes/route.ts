import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { invalidateComputeNodeCache } from "@/lib/compute-node-monitoring"
import { createPanelLog } from "@/lib/panel-log"
import { capabilityHeadline, refreshNodeCapabilities } from "@/lib/guest-automation/node-capabilities"
import { defaultCloneLimitForNodeClass } from "@/lib/node-workers"
import {
  boolValue,
  errorResponse,
  NO_CACHE_HEADERS,
  nodeResponse,
  requiredConnectionFields,
  testProxmoxConnection,
  textValue,
} from "./helpers"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  try {
    const [nodes, templateGroups] = await Promise.all([
      prisma.proxmoxNode.findMany({
        orderBy: { createdAt: "desc" },
        include: { guestCapabilities: true },
      }),
      prisma.osTemplate.groupBy({
        by: ["proxmoxNodeId"],
        where: {
          proxmoxNodeId: { not: null },
          source: "PROXMOX",
          syncedFromProxmox: true,
          proxmoxVmid: { not: null },
          isActive: true,
        },
        _count: { _all: true },
      }),
    ])

    const templatesByNode = new Map(
      templateGroups
        .filter((entry) => Boolean(entry.proxmoxNodeId))
        .map((entry) => [String(entry.proxmoxNodeId), Number(entry._count._all || 0)])
    )

    return NextResponse.json(
      nodes.map((node) =>
        nodeResponse({
          ...node,
          templatesCount: templatesByNode.get(node.id) ?? 0,
        })
      ),
      { headers: NO_CACHE_HEADERS }
    )
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_CACHE_HEADERS })
  }
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  try {
    const body = await request.json()
    const missing = requiredConnectionFields(body, true)
    if (missing.length) {
      return NextResponse.json({ error: `Missing required fields: ${missing.join(", ")}` }, { status: 400, headers: NO_CACHE_HEADERS })
    }

    const test = await testProxmoxConnection({
      host: textValue(body.host),
      tokenId: textValue(body.tokenId),
      tokenSecret: textValue(body.tokenSecret),
      nodeName: textValue(body.nodeName),
      allowInsecureTls: boolValue(body.allowInsecureTls),
      adminEmail: String(admin.email),
    })

    const node = await prisma.proxmoxNode.create({
      data: {
        name: textValue(body.name),
        host: test.host,
        tokenId: textValue(body.tokenId),
        tokenSecret: textValue(body.tokenSecret),
        nodeName: textValue(body.nodeName),
        location: textValue(body.location) || null,
        allowInsecureTls: boolValue(body.allowInsecureTls),
        sshUsername: textValue(body.sshUsername) || null,
        sshPassword: textValue(body.sshPassword) || null,
        resolvedIp: test.resolvedIp,
        // "connected" now means exactly that: the API answered. Whether the
        // node can actually carry guest automation is a separate, measured
        // answer, and the node is not schedulable until it is.
        status: "connected",
        lastCheckedAt: new Date(),
      },
      include: { nodeClass: { select: { name: true, slug: true } } },
    })
    await (prisma as any).nodeWorker.upsert({
      where: { nodeId: node.id },
      create: { nodeId: node.id, maxTasks: defaultCloneLimitForNodeClass(node.nodeClass), health: "connected" },
      update: { maxTasks: { set: defaultCloneLimitForNodeClass(node.nodeClass) }, health: "connected" },
    }).catch(() => null)
    invalidateComputeNodeCache(node.id)

    // Measure the node before anyone schedules work onto it. This is deliberately
    // after the create: a node that turns out to be unusable must exist in the
    // database so the admin can read the report and fix it, rather than vanish
    // with an error they cannot act on. What it must never do is stay
    // schedulable.
    const capabilities = await refreshNodeCapabilities({
      id: node.id,
      nodeName: node.nodeName,
      host: node.host,
      tokenId: node.tokenId,
      tokenSecret: node.tokenSecret,
      allowInsecureTls: node.allowInsecureTls,
    })
    if (capabilities.status !== "ready") {
      // Drain rather than delete: the admin needs the node to fix it, and an
      // unmeasured node must never receive a provisioning job.
      await prisma.proxmoxNode.update({
        where: { id: node.id },
        data: {
          schedulingEnabled: false,
          drainReason: capabilities.status === "pending"
            ? "Guest capabilities not yet measured. Start a server with a guest agent, then re-run diagnostics."
            : `Guest automation unavailable: ${capabilities.blockers[0] || "required capabilities failed"}`,
        },
      }).catch(() => null)
      await (prisma as any).nodeWorker.update({ where: { nodeId: node.id }, data: { health: "draining" } }).catch(() => null)
      invalidateComputeNodeCache(node.id)
    }
    await createPanelLog({
      category: "Compute Node",
      message: `Compute node ${node.name} added`,
      actorType: "admin",
      actorEmail: String(admin.email),
      metadata: {
        nodeId: node.id,
        nodeName: node.nodeName,
        host: node.host,
        capabilitiesStatus: capabilities.status,
        capabilitiesSummary: capabilities.summary,
        blockers: capabilities.blockers,
      },
    }).catch(() => null)

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
        schedulingEnabled: capabilities.status === "ready",
        templatesCount,
      }),
      capabilities,
      capabilitiesHeadline: capabilityHeadline(capabilities),
      // The wizard surfaces this on the final step rather than silently
      // finishing, so an admin always sees what was and was not verified.
      warning: capabilities.status === "ready"
        ? null
        : capabilities.status === "pending"
          ? "The node was added but is not schedulable yet: no running guest was available to measure the QEMU guest agent against. Clone a template with a guest agent, start a server, then re-run diagnostics."
          : `The node was added but is not schedulable: ${capabilities.blockers.join("; ")}`,
    }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return errorResponse(error)
  }
}
