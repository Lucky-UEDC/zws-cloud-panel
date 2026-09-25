import { NextRequest, NextResponse } from "next/server"
import { getAdminFromRequest } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { getGoogleDriveCallbackUrl, googleDriveConnectUrl } from "@/lib/google-drive-backup"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request)
  if (!admin?.email || !canAccessAdminApi(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const redirectUri = getGoogleDriveCallbackUrl(request)
    const url = await googleDriveConnectUrl({ adminEmail: String(admin.email), redirectUri })
    return NextResponse.redirect(url)
  } catch (error: any) {
    return NextResponse.redirect(new URL(`/admin/backups?googleDrive=${encodeURIComponent(error?.message || "connect_failed")}`, request.url))
  }
}
