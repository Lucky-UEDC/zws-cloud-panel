import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { getAdminFromCookies } from "@/lib/server-auth"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"

export const dynamic = "force-dynamic"

const ROOT_DIR = process.env.ZWS_ROOT_DIR || process.cwd()
const BACKUP_DIR = process.env.ZWS_BACKUP_DIR || path.join(ROOT_DIR, "backups")

function safeBackupPath(filePath: string) {
  const resolved = path.resolve(filePath)
  const backupRoot = path.resolve(BACKUP_DIR)
  return resolved.startsWith(`${backupRoot}${path.sep}`) || resolved === backupRoot ? resolved : null
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const { id } = await params
  const backup = await (prisma as any).backupRun.findUnique({ where: { id } })
  const localPath = safeBackupPath(String(backup?.localPath || ""))
  if (!backup || !localPath) {
    return NextResponse.json({ error: "Backup artifact is not available for download." }, { status: 404, headers: NO_CACHE_HEADERS })
  }

  const info = await stat(localPath).catch(() => null)
  if (!info?.isFile()) {
    return NextResponse.json({ error: "Backup artifact is not available for download." }, { status: 404, headers: NO_CACHE_HEADERS })
  }

  const bytes = await readFile(localPath)
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${path.basename(localPath).replace(/"/g, "")}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "no-store",
    },
  })
}
