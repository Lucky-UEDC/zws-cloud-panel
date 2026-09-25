import { NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { getAdminFromCookies } from "@/lib/server-auth"
import { getDeployment } from "@/lib/updates/apply"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

async function requireAdmin() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return null
  return admin
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

  const { id } = await context.params
  const deployment = await getDeployment(String(id))
  if (!deployment) return NextResponse.json({ success: false, error: "Deployment not found" }, { status: 404 })

  return NextResponse.json({
    success: true,
    deployment: {
      ...deployment,
      stageOutput: deployment.stageOutput as unknown,
    },
  })
}