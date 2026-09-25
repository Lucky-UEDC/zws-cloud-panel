import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const url = new URL('/api/payments/status', request.url)
  url.searchParams.set('order_id', id)
  const response = await fetch(url, {
    headers: { cookie: request.headers.get('cookie') || '' },
    cache: 'no-store',
  })
  const body = await response.text()
  return new NextResponse(body, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') || 'application/json' },
  })
}
