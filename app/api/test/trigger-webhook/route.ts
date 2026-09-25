import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isTestModeEnabled } from '@/lib/test-mode'

export async function GET() {
  if (!isTestModeEnabled()) {
    return NextResponse.json({ error: 'Test routes disabled' }, { status: 404 })
  }

  const payment = await prisma.payment.findFirst({
    where: {
      status: 'pending',
      OR: [
        { order: { orderNumber: { startsWith: 'TEST_' } } },
        { topupReference: { startsWith: 'TEST_' } },
      ],
    },
    include: { order: true },
    orderBy: { createdAt: 'desc' },
  })

  if (!payment) {
    return NextResponse.json({ error: 'No pending TEST payment found' }, { status: 404 })
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: 'completed',
      webhookProcessedAt: new Date(),
      completedAt: new Date(),
      paymentMethod: 'upi',
      gatewayPaymentId: `SIM_${Date.now()}`,
    },
  })

  if (payment.orderId) {
    await prisma.order.update({ where: { id: payment.orderId }, data: { status: 'paid' } })
  }

  return NextResponse.json({ success: true, paymentId: payment.id, orderNumber: payment.order?.orderNumber || null })
}
