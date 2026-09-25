import { NextRequest, NextResponse } from "next/server"
import { getAdminFromRequest } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { exchangeGoogleDriveCode, getGoogleDriveCallbackUrl, verifyGoogleDriveState } from "@/lib/google-drive-backup"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request)
  if (!admin?.email || !canAccessAdminApi(admin.role)) return NextResponse.redirect(new URL("/login?returnTo=/admin/backups", request.url))
  const code = String(request.nextUrl.searchParams.get("code") || "")
  const state = String(request.nextUrl.searchParams.get("state") || "")
  if (!code || !verifyGoogleDriveState(state, String(admin.email))) {
    return NextResponse.redirect(new URL("/admin/backups?googleDrive=invalid_state", request.url))
  }
  try {
    await exchangeGoogleDriveCode({ code, redirectUri: getGoogleDriveCallbackUrl(request) })
    return NextResponse.redirect(new URL("/admin/backups?googleDrive=connected", request.url))
  } catch (error: any) {
    return NextResponse.redirect(new URL(`/admin/backups?googleDrive=${encodeURIComponent(error?.message || "connect_failed")}`, request.url))
  }
}
