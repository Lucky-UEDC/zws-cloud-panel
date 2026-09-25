import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"
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

    return NextResponse.json(test, { headers: NO_CACHE_HEADERS })
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
