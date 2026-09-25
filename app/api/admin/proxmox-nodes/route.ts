import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
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
