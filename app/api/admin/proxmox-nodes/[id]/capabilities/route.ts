import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { decryptSecretValue, isEncryptedSecret } from "@/lib/secret-crypto"
import { createPanelLog } from "@/lib/panel-log"
import { capabilityHeadline, getNodeCapabilities, refreshNodeCapabilities } from "@/lib/guest-automation/node-capabilities"
import { errorResponse, NO_CACHE_HEADERS } from "../../helpers"

export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * The capability report for one node.
 *
 * GET returns the cached report, re-measuring only once it is stale, so the node
 * list can render it without hitting the Proxmox API on every load. POST forces
 * a fresh measurement — the "Re-run diagnostics" button.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  try {
    const { id } = await context.params
    const node = await prisma.proxmoxNode.findUnique({ where: { id } })
    if (!node) {
      return NextResponse.json({ success: false, error: "Node not found" }, { status: 404, headers: NO_CACHE_HEADERS })
    }
    const report = await getNodeCapabilities(nodeTarget(node))
    return NextResponse.json({ success: true, ...report, headline: capabilityHeadline(report) }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  try {
    const { id } = await context.params
    const node = await prisma.proxmoxNode.findUnique({ where: { id } })
    if (!node) {
      return NextResponse.json({ success: false, error: "Node not found" }, { status: 404, headers: NO_CACHE_HEADERS })
    }

    const report = await refreshNodeCapabilities(nodeTarget(node))
    await createPanelLog({
      category: "Compute Node",
      message: `Node guest capabilities re-measured: ${report.status}`,
      actorType: "admin",
      actorEmail: String(admin.email),
      metadata: {
        nodeId: node.id,
        nodeName: node.nodeName,
        status: report.status,
        summary: report.summary,
        blockers: report.blockers,
      },
    }).catch(() => null)

    return NextResponse.json({ success: true, ...report, headline: capabilityHeadline(report) }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return errorResponse(error)
  }
}

function nodeTarget(node: { id: string; nodeName: string; host: string; tokenId: string; tokenSecret: string; allowInsecureTls?: boolean | null }) {
  return {
    id: node.id,
    nodeName: node.nodeName,
    host: node.host,
    tokenId: node.tokenId,
    // The stored secret is encrypted at rest; the diagnostics need the real one.
    tokenSecret: isEncryptedSecret(node.tokenSecret) ? decryptSecretValue(node.tokenSecret) : node.tokenSecret,
    allowInsecureTls: node.allowInsecureTls,
  }
}
