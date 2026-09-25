import { NextResponse } from 'next/server'
import { isTestModeEnabled } from '@/lib/test-mode'
import { syncPlans } from '@/lib/plan-sync'

export async function GET() {
  if (!isTestModeEnabled()) {
    return NextResponse.json({ error: 'Test routes disabled' }, { status: 404 })
  }

  const result = await syncPlans({ trigger: 'test', triggeredBy: 'test-route' })
  return NextResponse.json({ success: true, result })
}
