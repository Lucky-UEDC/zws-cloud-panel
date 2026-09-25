import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createPaymentOrder } from '@/lib/cashfree'
import { isTestModeEnabled } from '@/lib/test-mode'

export async function GET() {
  if (!isTestModeEnabled()) {
    return NextResponse.json({ error: 'Test routes disabled' }, { status: 404 })
  }

  const customerEmail = process.env.TEST_CUSTOMER_EMAIL || 'test.customer@example.com'
  const customer = await prisma.customer.upsert({
    where: { email: customerEmail },
    update: { isActive: true, phone: '9999999999', name: 'Test Customer' },
    create: { email: customerEmail, isActive: true, phone: '9999999999', name: 'Test Customer' },
  })

  const orderNumber = `TEST_${Date.now()}`
  const order = await prisma.order.create({
    data: {
      orderNumber,
      customerId: customer.id,
      termMonths: 1,
      unitPrice: 1,
      quantity: 1,
      subtotal: 1,
      taxAmount: 0,
      totalAmount: 1,
      currency: 'INR',
      status: 'pending',
    },
  })

  const paymentOrder = await createPaymentOrder({
    orderId: orderNumber,
    orderAmount: 1,
    customerDetails: {
      customerId: customer.id,
      customerEmail: customer.email,
      customerPhone: customer.phone || '9999999999',
      customerName: customer.name || 'Test Customer',
    },
    orderNote: 'Sandbox test order',
  })

  await prisma.payment.create({
    data: {
      orderId: order.id,
      customerId: customer.id,
      gateway: 'cashfree',
      gatewayOrderId: paymentOrder.cfOrderId,
      gatewaySessionId: paymentOrder.paymentSessionId,
      amount: 1,
      currency: 'INR',
      status: 'pending',
      purpose: 'order_payment',
      idempotencyKey: `${orderNumber}-test`,
    },
  })

  return NextResponse.json({
    success: true,
    orderNumber,
    paymentSessionId: paymentOrder.paymentSessionId,
    paymentUrl: paymentOrder.payments.url,
  })
}
