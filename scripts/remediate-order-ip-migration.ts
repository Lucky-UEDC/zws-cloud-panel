import "dotenv/config"
import { prisma } from "@/lib/db"
import { ipPoolReadiness } from "@/lib/ip-pool"
import { createPanelLog } from "@/lib/panel-log"
import { recordCapacityAlert } from "@/lib/provisioning-alerts"
import { changePrimaryIp } from "@/lib/vm-network-orchestrator"

const ORDER_NUMBER = "ZWS-MPPHBFI6-XTF4"
const TARGET_RANGE = { startIp: "151.243.146.120", endIp: "151.243.146.140" }
const apply = process.argv.includes("--apply")

async function main() {
  const order = await prisma.order.findUnique({
    where: { orderNumber: ORDER_NUMBER },
    include: {
      customer: { select: { id: true, email: true, name: true } },
      product: { select: { id: true, name: true } },
      vpsInstance: { include: { proxmoxNode: true } },
    },
  })
  if (!order) throw new Error(`Order ${ORDER_NUMBER} not found`)
  const vps = order.vpsInstance
  if (!vps) throw new Error(`Order ${ORDER_NUMBER} has no linked VM`)

  const pool = await prisma.ipPool.findFirst({
    where: {
      isActive: true,
      startIp: { lte: TARGET_RANGE.startIp },
      endIp: { gte: TARGET_RANGE.endIp },
    },
  })
  if (!pool) throw new Error(`Target pool ${TARGET_RANGE.startIp}-${TARGET_RANGE.endIp} not found`)

  const readiness = await ipPoolReadiness({
    proxmoxNodeId: vps.proxmoxNodeId,
    productId: order.productId,
    poolId: pool.id,
    allocationType: "default",
    availableLimit: 50,
  })

  const baseMetadata = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    vpsInstanceId: vps.id,
    vmid: vps.vmid,
    currentIp: vps.ipAddress,
    targetPoolId: pool.id,
    targetRange: `${TARGET_RANGE.startIp}-${TARGET_RANGE.endIp}`,
    customerEmail: order.customer?.email || null,
  }

  if (!readiness.ok || !readiness.selectedIp) {
    await createPanelLog({
      category: "IP Migration",
      level: "warn",
      message: "Controlled order IP migration blocked by target pool capacity",
      orderId: order.id,
      vpsInstanceId: vps.id,
      vmid: vps.vmid,
      metadata: { ...baseMetadata, readiness },
    }).catch(() => null)
    await recordCapacityAlert({
      event: "node_full",
      dedupeKey: `order:${order.id}:ip_migration_capacity_blocked`,
      title: "Order IP migration blocked",
      message: `🚨 Capacity Alert\n\nOrder:\n${order.orderNumber}\n\nTarget Pool:\n${TARGET_RANGE.startIp}-${TARGET_RANGE.endIp}\n\nStatus:\nNo free IP available\n\nAction Required:\nFree or extend the pool before migration.`,
      nodeId: vps.proxmoxNodeId,
      severity: "critical",
      metadata: baseMetadata,
    }).catch(() => null)
    console.log(JSON.stringify({ success: false, blocked: true, reason: readiness.reason, ...baseMetadata }, null, 2))
    return
  }

  if (!apply) {
    console.log(JSON.stringify({
      success: true,
      dryRun: true,
      message: "Target IP is available. Re-run with --apply to migrate.",
      targetIp: readiness.selectedIp,
      ...baseMetadata,
    }, null, 2))
    return
  }

  const result = await changePrimaryIp({
    vpsId: vps.id,
    actorEmail: "system:controlled-order-ip-migration",
    actorRole: "system",
    targetIp: readiness.selectedIp,
    poolId: pool.id,
    preserveOldIp: false,
    forceOverride: false,
    reason: `Controlled remediation for ${ORDER_NUMBER}`,
    dryRun: false,
    confirmRisky: true,
    idempotencyKey: `order-ip-migration:${order.id}:${pool.id}:${readiness.selectedIp}`,
  })

  await createPanelLog({
    category: "IP Migration",
    level: "info",
    message: "Controlled order IP migration completed",
    orderId: order.id,
    vpsInstanceId: vps.id,
    vmid: vps.vmid,
    metadata: { ...baseMetadata, targetIp: readiness.selectedIp, result },
  }).catch(() => null)
  console.log(JSON.stringify({ success: true, applied: true, targetIp: readiness.selectedIp, result }, null, 2))
}

main()
  .catch((error) => {
    console.error("[remediate-order-ip-migration] failed", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => null)
    process.exit(process.exitCode || 0)
  })
