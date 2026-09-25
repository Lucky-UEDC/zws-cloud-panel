import { NextRequest, NextResponse } from "next/server"
import { getRuntimeIntegrationConfig, updateRuntimeIntegrationConfig } from "@/lib/integration-config"
import { ensureRuntimeBackupDestination } from "@/lib/backups"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"

export const dynamic = "force-dynamic"

async function requireAdmin() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return null
  return admin
}

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const config = await getRuntimeIntegrationConfig({ decrypted: false, masked: true }).catch(() => ({}))
  return NextResponse.json({
    success: true,
    backups: (config as any).backups || {},
    googleDriveBackups: (config as any).googleDriveBackups || {},
    googleDriveAttachmentStorage: (config as any).googleDriveAttachmentStorage || {},
  })
}

export async function PUT(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const all = await getRuntimeIntegrationConfig({ decrypted: true, masked: false }).catch(() => ({} as any))
  const next = {
    ...all,
    backups: { ...(all.backups || {}), ...(body.backups || {}) },
    googleDriveBackups: { ...(all.googleDriveBackups || {}), ...(body.googleDriveBackups || {}) },
    googleDriveAttachmentStorage: { ...(all.googleDriveAttachmentStorage || {}), ...(body.googleDriveAttachmentStorage || {}) },
  }
  await updateRuntimeIntegrationConfig(next, String(admin.email))
  await ensureRuntimeBackupDestination(String(admin.email)).catch(() => null)
  return NextResponse.json({ success: true })
}
