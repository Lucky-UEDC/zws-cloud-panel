import { NextResponse } from 'next/server'
import { getAdminFromCookies } from '@/lib/server-auth'
import { prisma } from '@/lib/db'
import { canManageCatalog } from "@/lib/admin-rbac"

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageCatalog(admin.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runs = await prisma.planSyncRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: 20,
  })

  return NextResponse.json({ runs })
}
