import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"
import { measureNodeCapabilities } from "@/lib/guest-automation/node-capabilities"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import {
  boolValue,
  errorResponse,
  NO_CACHE_HEADERS,
  requiredConnectionFields,
  testProxmoxConnection,
  textValue,
} from "../helpers"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  try {
    const body = await request.json()
    const id = textValue(body.id)
    const existing = id ? await prisma.proxmoxNode.findUnique({ where: { id } }) : null
    if (id && !existing) {
      return NextResponse.json({ success: false, error: "Node not found" }, { status: 404, headers: NO_CACHE_HEADERS })
    }

    const missing = requiredConnectionFields(body, !existing)
    if (missing.length) {
      return NextResponse.json(
        { success: false, error: `Missing required fields: ${missing.join(", ")}` },
        { status: 400, headers: NO_CACHE_HEADERS }
      )
    }

    const tokenId = textValue(body.tokenId) || existing?.tokenId || ""
    const tokenSecret = textValue(body.tokenSecret) || existing?.tokenSecret || ""
    const allowInsecureTls = body.allowInsecureTls === undefined && existing ? existing.allowInsecureTls : boolValue(body.allowInsecureTls)
    if (!tokenId || !tokenSecret) {
      return NextResponse.json({ success: false, error: "Missing required fields: tokenId/tokenSecret" }, { status: 400, headers: NO_CACHE_HEADERS })
    }

    const test = await testProxmoxConnection({
      host: textValue(body.host),
      tokenId,
      tokenSecret,
      nodeName: textValue(body.nodeName),
      allowInsecureTls,
      adminEmail: String(admin.email),
    })
    await createPanelLog({
      category: "Compute Node",
      message: "Node test successful",
      actorType: "admin",
      actorEmail: String(admin.email),
      metadata: { nodeId: id || null, nodeName: textValue(body.nodeName), host: test.host },
    })

    // The wizard asks for the capability report before the node exists, so the
    // admin sees the verdict before committing rather than discovering it during
    // a customer's first provisioning job. The authoritative measurement is
    // still taken on create; this one is a pre-flight.
    let capabilities: unknown = null
    if (body.capabilitiesOnly === true) {
      const measured = await measureNodeCapabilities({
        host: test.host,
        tokenId,
        tokenSecret,
        nodeName: textValue(body.nodeName),
        allowInsecureTls,
      })
      capabilities = {
        status: measured.status,
        checks: measured.checks,
        summary: measured.summary,
        blockers: measured.blockers,
        lastCheckedAt: new Date().toISOString(),
        headline: `${measured.status === "ready"
          ? "Ready — guest agent and guest-exec verified"
          : measured.blockers[0] || "Guest capabilities have not been measured"}`,
      }
    }

    return NextResponse.json({ ...test, capabilities }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    await createPanelLog({
      category: "Compute Node",
      level: "error",
      message: /auth|permission|token/i.test(String(error?.message || "")) ? "Node test auth/permission error" : "Node test failed",
      actorType: "admin",
      actorEmail: String(admin.email),
      metadata: { error: error?.message || "Connection failed", status: error?.status || null },
    })
    return errorResponse(error)
  }
}
