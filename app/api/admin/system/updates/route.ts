import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { getAdminFromCookies } from "@/lib/server-auth"
import { getBuildInfo } from "@/lib/build-info"
import { listTrustedReleases, getUpdateSource } from "@/lib/updates/releases"
import { applyRelease, listDeploymentHistory, UPDATE_LOCK_KEY } from "@/lib/updates/apply"
import { getRedisClient } from "@/lib/redis"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

async function requireAdmin() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return null
  return admin
}

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

  const source = getUpdateSource()
  const current = getBuildInfo()
  const [releases, history] = await Promise.all([listTrustedReleases(), listDeploymentHistory(25)])

  let lockHeld = false
  const redis = getRedisClient()
  if (redis) {
    try {
      await redis.connect().catch(() => undefined)
      lockHeld = Boolean(await redis.get(UPDATE_LOCK_KEY))
    } catch {
      lockHeld = false
    }
  } else {
    lockHeld = history.some((d) => d.status === "running" || d.status === "apply_pending")
  }

  return NextResponse.json({
    success: true,
    configured: source.enabled,
    repo: source.enabled ? source.repo : null,
    current,
    newerAvailable: releases.releases.some((r: { invalidReason: string | null }) => !r.invalidReason),
    lockHeld,
    releases: releases.releases.slice(0, 10),
    releaseError: releases.error,
    history: history.map((d: { id: string; version: string; image: string; status: string; stage: string | null; startedBy: string | null; startedAt: Date | null; completedAt: Date | null; error: string | null }) => ({
      id: d.id,
      version: d.version,
      image: d.image,
      status: d.status,
      stage: d.stage,
      startedBy: d.startedBy,
      startedAt: d.startedAt,
      completedAt: d.completedAt,
      error: d.error,
    })),
  })
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin?.email) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

  let body: { version?: unknown } = {}
  try {
    body = (await request.json()) as { version?: unknown }
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 })
  }
  const version = String(body.version || "").trim()

  const outcome = await applyRelease(version, admin.email)
  const status = outcome.status === "success" ? 200 : outcome.status === "invalid" ? 400 : 409
  return NextResponse.json({ success: outcome.status === "success", ...outcome }, { status })
}