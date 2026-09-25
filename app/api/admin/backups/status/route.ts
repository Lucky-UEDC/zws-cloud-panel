import { NextResponse } from "next/server"
import { backupHealth } from "@/lib/backup-health"
import { googleDriveBackupHealth, testGoogleDriveBackupUpload } from "@/lib/google-drive-backup"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"

export const dynamic = "force-dynamic"

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const [health, googleDrive] = await Promise.all([
    backupHealth().catch((error: any) => ({ ok: false, error: error?.message || String(error) })),
    googleDriveBackupHealth().catch((error: any) => ({ ok: false, error: error?.message || String(error) })),
  ])
  return NextResponse.json({ success: true, health, googleDrive }, { headers: { "Cache-Control": "no-store" } })
}

export async function POST() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const result = await testGoogleDriveBackupUpload()
    return NextResponse.json({ success: true, result })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Google Drive test failed" }, { status: 502 })
  }
}
