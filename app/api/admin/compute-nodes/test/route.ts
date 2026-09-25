import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { PROXMOX_VALIDATION_TIMEOUT_MS, runProxmoxDiagnostics } from "@/lib/proxmox/client"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { diagnosticSummary } from "@/app/api/admin/proxmox-nodes/helpers"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function boolValue(value: unknown) {
  return value === true || value === "true" || value === "on"
}

function resolvedIpFromSteps(steps: Array<{ name?: string; address?: string | null; addresses?: string[] }>) {
  const dns = steps.find((step) => step.name === "DNS resolve host")
  return dns?.address || dns?.addresses?.[0] || null
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ ok: false, error: "Unauthorized", message: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const body = await request.json().catch(() => ({}))
  const id = textValue(body.id)
  const existing = id ? await prisma.proxmoxNode.findUnique({ where: { id } }) : null
  if (id && !existing) {
    return NextResponse.json({ ok: false, error: "Node not found", message: "Node not found", code: "NODE_NOT_FOUND", steps: [] }, { status: 404, headers: NO_CACHE_HEADERS })
  }

  const host = textValue(body.host) || existing?.host || ""
  const nodeName = textValue(body.nodeName) || existing?.nodeName || ""
  const tokenId = textValue(body.tokenId) || existing?.tokenId || ""
  const tokenSecret = textValue(body.tokenSecret) || existing?.tokenSecret || ""
  const allowInsecureTls = body.allowInsecureTls === undefined && existing ? existing.allowInsecureTls : boolValue(body.allowInsecureTls)

  const missing = []
  if (!host) missing.push("host")
  if (!nodeName) missing.push("nodeName")
  if (!tokenId) missing.push("tokenId")
  if (!tokenSecret) missing.push("tokenSecret")
  if (missing.length) {
    return NextResponse.json(
      { ok: false, error: `Missing required fields: ${missing.join(", ")}`, message: `Missing required fields: ${missing.join(", ")}`, code: "UNKNOWN_ERROR", steps: [] },
      { status: 400, headers: NO_CACHE_HEADERS },
    )
  }

  try {
    const diagnostic = await runProxmoxDiagnostics({
      host,
      nodeName,
      tokenId,
      tokenSecret,
      allowInsecureTls,
      timeoutMs: PROXMOX_VALIDATION_TIMEOUT_MS,
    })

    return NextResponse.json(
      {
        success: diagnostic.ok,
        ok: diagnostic.ok,
        code: diagnostic.code,
        message: diagnostic.message,
        error: diagnostic.ok ? null : diagnostic.message,
        host: diagnostic.host,
        nodeName: diagnostic.nodeName,
        resolvedIp: resolvedIpFromSteps(diagnostic.steps),
        nodes: diagnostic.nodes,
        matchedNode: diagnostic.matchedNode,
        diagnostics: diagnosticSummary(diagnostic.steps, diagnostic.ok),
        steps: diagnostic.steps,
      },
      { status: diagnostic.ok ? 200 : 400, headers: NO_CACHE_HEADERS },
    )
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        ok: false,
        code: error?.code || "UNKNOWN_ERROR",
        error: error?.message || "Proxmox diagnostic failed",
        message: error?.message || "Proxmox diagnostic failed",
        diagnostics: diagnosticSummary(error?.steps || error?.diagnostic?.steps || [], false),
        steps: error?.steps || error?.diagnostic?.steps || [],
      },
      { status: error?.status || 500, headers: NO_CACHE_HEADERS },
    )
  }
}
