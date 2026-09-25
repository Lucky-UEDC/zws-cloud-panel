import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { getCachedRoutingCompatibility } from "@/lib/os-routing"
import { getAdminFromCookies } from "@/lib/server-auth"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export async function GET(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const purposeParam = String(request.nextUrl.searchParams.get("purpose") || "admin")
  const purpose = ["provision", "reinstall", "checkout", "admin"].includes(purposeParam) ? purposeParam as any : "admin"
  const result = await getCachedRoutingCompatibility({
    nodeId: request.nextUrl.searchParams.get("nodeId"),
    templateId: request.nextUrl.searchParams.get("templateId"),
    productId: request.nextUrl.searchParams.get("productId"),
    purpose,
  })

  return NextResponse.json({ success: true, ...result }, { headers: NO_CACHE_HEADERS })
}
