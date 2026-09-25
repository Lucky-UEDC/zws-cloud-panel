import { NextRequest, NextResponse } from "next/server"
import { uploadBackupArtifact } from "@/lib/backups"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { getAdminFromCookies } from "@/lib/server-auth"
import { safeJson } from "@/lib/safe-json"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  try {
    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File)) return NextResponse.json({ success: false, error: "Backup file is required." }, { status: 400, headers: NO_CACHE_HEADERS })
    const bytes = Buffer.from(await file.arrayBuffer())
    const run = await uploadBackupArtifact({ fileName: file.name, bytes, createdBy: String(admin.email) })
    return NextResponse.json(safeJson({ success: true, run }), { status: 201, headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Backup upload failed." }, { status: error?.status || 500, headers: NO_CACHE_HEADERS })
  }
}
