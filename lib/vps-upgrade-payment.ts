import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { createVpsUpgradeOrder } from "@/lib/provision"
import { createPanelLog } from "@/lib/panel-log"
import { POST as createPayment } from "@/app/api/payments/create/route"

export async function startVpsUpgradePayment(request: NextRequest, vpsId: string, customerId: string, body: any) {
  const vps = await prisma.vpsInstance.findFirst({
    where: {
      id: vpsId,
      customerId,
      deletedAt: null,
      status: { not: "DELETED" },
      order: { deletedAt: null, status: { not: "DELETED" } },
    },
  })
  if (!vps) return NextResponse.json({ error: "Instance not found" }, { status: 404 })

  const cpuCores = body.cpuCores === undefined ? undefined : Number(body.cpuCores)
  const ramGb = body.ramGb === undefined ? undefined : Number(body.ramGb)
  const diskGb = body.diskGb === undefined ? undefined : Number(body.diskGb)
  const termMonths = body.termMonths === undefined ? undefined : Number(body.termMonths)
  const storagePoolId = body.storagePoolId ? String(body.storagePoolId) : null
  const paymentMethod = String(body.paymentMethod || "gateway").toLowerCase() === "wallet" ? "wallet" : "gateway"
  if ([cpuCores, ramGb, diskGb].some((value) => value !== undefined && (!Number.isFinite(value) || value <= 0))) {
    return NextResponse.json({ error: "Upgrade values must be positive numbers" }, { status: 400 })
  }
  if (termMonths !== undefined && ![1, 3, 6, 12].includes(termMonths)) {
    return NextResponse.json({ error: "Upgrade billing term is invalid" }, { status: 400 })
  }

  try {
    const upgrade = await createVpsUpgradeOrder({
      vpsInstanceId: vps.id,
      customerId,
      cpuCores,
      ramGb,
      diskGb,
      termMonths,
      storagePoolId,
    })
    await createPanelLog({
      category: "Provisioning",
      message: "upgrade_order_created",
      customerId,
      orderId: upgrade.order.id,
      vpsInstanceId: vps.id,
      vmid: vps.vmid,
      metadata: { amount: Number(upgrade.amount), cpuCores, ramGb, diskGb, termMonths: upgrade.order.termMonths, paymentMethod },
    }).catch(() => null)

    const paymentRequest = new NextRequest(new URL("/api/payments/create", request.url), {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({
        purpose: "upgrade_order",
        existingOrderId: upgrade.order.id,
        vpsInstanceId: vps.id,
        upgradeCpuCores: cpuCores,
        upgradeRamGb: ramGb,
        upgradeDiskGb: diskGb,
        paymentMethod,
        term: upgrade.order.termMonths,
        idempotencyKey: body.idempotencyKey ? String(body.idempotencyKey) : undefined,
      }),
    })
    const paymentResponse = await createPayment(paymentRequest)
    const paymentData = await paymentResponse.json().catch(() => ({}))
    if (!paymentResponse.ok || paymentData?.success === false || paymentData?.ok === false) {
      return NextResponse.json({
        success: false,
        error: paymentData?.message || paymentData?.error || "Failed to initialize upgrade payment",
        code: paymentData?.code || "UPGRADE_PAYMENT_INIT_FAILED",
        orderId: upgrade.order.id,
        upgradeOrderId: upgrade.order.id,
      }, { status: paymentResponse.status || 502 })
    }

    return NextResponse.json({
      ...paymentData,
      success: true,
      ok: true,
      orderId: upgrade.order.id,
      upgradeOrderId: upgrade.order.id,
      upgradeOrderNumber: upgrade.order.orderNumber,
      invoiceId: paymentData.invoiceId || null,
      paymentUrl: paymentData.paymentUrl || paymentData.payment_url || paymentData.checkout_url || paymentData.redirectUrl || null,
      redirectUrl: paymentData.redirectUrl || paymentData.paymentUrl || paymentData.payment_url || paymentData.checkout_url || null,
      amount: Number(upgrade.amount),
      termMonths: upgrade.order.termMonths,
      paymentMethod,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Upgrade failed" }, { status: 400 })
  }
}
