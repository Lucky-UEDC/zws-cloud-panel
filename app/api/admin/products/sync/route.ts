import { NextRequest, NextResponse } from 'next/server'
import { syncPlans } from '@/lib/plan-sync'
import { apiError } from '@/lib/api-response'
import { canManageCatalog } from "@/lib/admin-rbac"
import { requireAdminFullAuth, requireSameOriginOrCsrf } from "@/lib/auth/guards"

export async function POST(request: NextRequest) {
  const auth = await requireAdminFullAuth(request)
  if (!auth.ok) return auth.response
  const origin = await requireSameOriginOrCsrf(request)
  if (!origin.ok) return origin.response
  const admin = { email: auth.session.email, role: auth.session.role }
  if (!admin.email || !canManageCatalog(admin.role)) {
    return apiError('unauthorized', 'Unauthorized', 401)
  }

  const body = await request.json().catch(() => ({}))
  const trigger = body?.trigger === 'auto' ? 'auto' : 'manual'

  try {
    const result = await syncPlans({ trigger, triggeredBy: String(admin.email) })
    return NextResponse.json({ success: true, result })
  } catch (error) {
    console.error('Plan sync failed:', error)
    return apiError('server_error', 'Failed to sync plans', 500)
  }
}
