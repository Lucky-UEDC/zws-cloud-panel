import { prisma } from "@/lib/db"
import { getProvisioningPaymentGate } from "@/lib/payment-state"
import { createPanelLog } from "@/lib/panel-log"

function flagArg(name: string) {
  return process.argv.includes(name)
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

const apply = flagArg("--apply")
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="))
const limit = Math.max(1, Math.min(500, Number(limitArg?.split("=")[1] || 100)))

const suspiciousProvisioningStatuses = [
  "QUEUED",
  "SELECTING_NODE",
  "CLONING_TEMPLATE",
  "CLONE_COMPLETE",
  "RESIZING_DISK",
  "ASSIGNING_IP",
  "APPLYING_CLOUD_INIT",
  "STARTING_VM",
  "VERIFYING_VM",
  "ACTIVE",
  "UPGRADE_QUEUED",
]

async function main() {
  const orders = await prisma.order.findMany({
    where: {
      deletedAt: null,
      OR: [
        { status: { notIn: ["paid", "payment_verified", "active"] } },
        { payments: { none: { status: { in: ["completed", "paid", "success"] } } } },
      ],
      AND: [
        {
          OR: [
            { provisioningStatus: { in: suspiciousProvisioningStatuses } },
            { provisioningJobs: { some: { status: { in: ["queued", "running", "waiting_for_admin"] } } } },
            { vpsInstance: { isNot: null } },
            { vmId: { not: null } },
          ],
        },
      ],
    },
    include: {
      vpsInstance: { select: { id: true, vmid: true, status: true, ipAddress: true } },
      provisioningJobs: { where: { status: { in: ["queued", "running", "waiting_for_admin"] } }, select: { id: true, status: true, type: true }, take: 20 },
      payments: { orderBy: { createdAt: "desc" }, take: 3, select: { id: true, gateway: true, status: true, gatewayTransactionId: true, completedAt: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  })

  let flagged = 0
  let blockedJobs = 0
  const report = []

  for (const order of orders) {
    const gate = await getProvisioningPaymentGate(order.id)
    if (gate.ok) continue
    flagged += 1
    report.push({
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      provisioningStatus: order.provisioningStatus,
      reason: gate.reason,
      vps: order.vpsInstance,
      jobs: order.provisioningJobs,
      payments: order.payments,
    })

    if (!apply) continue

    const updateJobs = await prisma.provisioningJob.updateMany({
      where: { orderId: order.id, status: { in: ["queued", "running"] } },
      data: {
        status: "waiting_for_admin",
        currentStep: "PAYMENT_VERIFICATION_REQUIRED",
        displayStatus: "Payment verification required",
        error: `Provisioning blocked: ${gate.reason}`,
      },
    })
    blockedJobs += updateJobs.count
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: "pending_payment",
        provisioningStatus: "PAYMENT_VERIFICATION_REQUIRED",
        provisioningError: `Provisioning blocked: ${gate.reason}`,
        metadata: {
          ...record(order.metadata),
          provisioningBlocked: {
            reason: gate.reason,
            repairedAt: new Date().toISOString(),
            repairScript: "repair-unverified-provisioning",
          },
        },
      },
    })
    await createPanelLog({
      category: "Payment",
      level: "warn",
      message: "unverified_provisioning_blocked",
      customerId: order.customerId,
      orderId: order.id,
      metadata: { reason: gate.reason, blockedJobs: updateJobs.count, vpsInstanceId: order.vpsInstance?.id || null },
    }).catch(() => null)
  }

  console.log(JSON.stringify({
    dryRun: !apply,
    scanned: orders.length,
    flagged,
    blockedJobs,
    report,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
