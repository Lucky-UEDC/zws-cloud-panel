import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { createPanelLog } from "@/lib/panel-log"
import { createProxmoxClient, PROXMOX_LONG_TIMEOUT_MS } from "@/lib/proxmox"
import { getAdminFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

function safeIsoName(name: string) {
  const cleaned = name.split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]/g, "-") || ""
  if (!cleaned.toLowerCase().endsWith(".iso")) throw new Error("Only .iso files can be uploaded")
  return cleaned
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const { id } = await params
  try {
    const node = await prisma.proxmoxNode.findUnique({ where: { id } })
    if (!node) return NextResponse.json({ success: false, error: "Node not found" }, { status: 404, headers: NO_CACHE_HEADERS })

    const form = await request.formData()
    const storage = String(form.get("storage") || "").trim()
    const file = form.get("file")
    if (!storage) return NextResponse.json({ success: false, error: "Storage is required" }, { status: 400, headers: NO_CACHE_HEADERS })
    if (!(file instanceof File)) return NextResponse.json({ success: false, error: "ISO file is required" }, { status: 400, headers: NO_CACHE_HEADERS })
    const filename = safeIsoName(file.name)
    if (file.size <= 0) return NextResponse.json({ success: false, error: "ISO file is empty" }, { status: 400, headers: NO_CACHE_HEADERS })

    const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, {
      allowInsecureTls: node.allowInsecureTls,
      timeoutMs: PROXMOX_LONG_TIMEOUT_MS,
    })
    const result = await client.uploadStorageContent(node.nodeName, storage, { file, filename, content: "iso" })
    await createPanelLog({
      category: "Compute Node",
      message: "ISO upload requested",
      actorType: "admin",
      actorEmail: String(admin.email),
      metadata: { nodeId: node.id, nodeName: node.nodeName, storage, filename, size: file.size, result },
    }).catch(() => null)
    return NextResponse.json({ success: true, result, filename, storage }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: String(error?.message || "ISO upload failed"),
      code: error?.code || null,
    }, { status: 400, headers: NO_CACHE_HEADERS })
  }
}
