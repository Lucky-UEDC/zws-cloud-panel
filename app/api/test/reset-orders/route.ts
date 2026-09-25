import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isTestModeEnabled } from '@/lib/test-mode'

export async function GET() {
  if (!isTestModeEnabled()) {
    return NextResponse.json({ error: 'Test routes disabled' }, { status: 404 })
  }

  const orders = await prisma.order.findMany({
    where: { orderNumber: { startsWith: 'TEST_' } },
    select: { id: true },
  })
  const orderIds = orders.map((o) => o.id)

  await prisma.payment.deleteMany({ where: { OR: [{ order: { orderNumber: { startsWith: 'TEST_' } } }, { topupReference: { startsWith: 'TEST_' } }] } })
  await prisma.invoice.deleteMany({ where: { order: { orderNumber: { startsWith: 'TEST_' } } } })
  if (orderIds.length) {
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } })
  }

  return NextResponse.json({ success: true, deletedOrders: orderIds.length })
}
