import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { syncOsTemplatesFromProxmox, syncSingleNodeOperatingSystems } from "@/lib/os-template-sync"
import { canManageCatalog } from "@/lib/admin-rbac"
import { revalidateProductSurfaces } from "@/lib/product-revalidation"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export async function POST(request: Request) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageCatalog(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const selectedNodeId = String(body?.nodeId || body?.proxmoxNodeId || "")
    const result = selectedNodeId
      ? await (async () => {
          const node = await prisma.proxmoxNode.findFirst({
            where: { id: selectedNodeId, isActive: true },
            select: { id: true, name: true, nodeName: true, host: true, tokenId: true, tokenSecret: true, allowInsecureTls: true },
          })
          if (!node) throw Object.assign(new Error("Selected active node was not found."), { status: 404 })
          return syncSingleNodeOperatingSystems(node, String(admin.email))
        })()
      : await syncOsTemplatesFromProxmox(String(admin.email))
    revalidateProductSurfaces()
    return NextResponse.json({ success: true, result }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to sync templates",
      },
      { status: error?.status && Number.isInteger(error.status) ? error.status : 500, headers: NO_CACHE_HEADERS }
    )
  }
}
