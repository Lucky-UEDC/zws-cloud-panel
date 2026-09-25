import "dotenv/config"
import { prisma } from "@/lib/db"
import { createProxmoxClient, ProxmoxError } from "@/lib/proxmox"
import { createInvoiceForOrder } from "@/lib/invoices"
import { handlePaidInvoice } from "@/lib/payment-finalization"
import { encryptSecret } from "@/lib/provision"

const VMID = 465543
const ORDER_NUMBER = "TEST-465543"
const NODE_ID = process.env.TEST_VM_NODE_ID || "cmu08miku004gps07bds9hph1"
const TEMPLATE_PREFERENCE = ["Ubuntu-24.04", "Ubuntu-22.04", "Debian-12", "Ubuntu-20-04"]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  if (!process.argv.includes("--confirmed")) {
    console.error(`This script creates a REAL Proxmox VM (vmid ${VMID}) via the production provisioning pipeline.`)
    console.error(`Re-run with --confirmed to proceed.`)
    process.exit(1)
  }

  const existingOrder = await prisma.order.findUnique({ where: { orderNumber: ORDER_NUMBER } })
  if (existingOrder) {
    console.log(`Order ${ORDER_NUMBER} already exists (${existingOrder.id}); skipping creation.`)
    return printStatus(existingOrder.id)
  }
  const existingVps = await prisma.vpsInstance.findFirst({ where: { vmid: VMID } })
  if (existingVps) throw new Error(`vmid ${VMID} is already in use by vps instance ${existingVps.id}`)

  const node = await prisma.proxmoxNode.findFirst({ where: { id: NODE_ID, isActive: true } })
  if (!node || !node.host || !node.nodeName) throw new Error("Active Proxmox node not found")
  const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, { allowInsecureTls: node.allowInsecureTls })
  const existingVms = await client.getVMList(node.nodeName).catch(() => [])
  if (existingVms.some((vm: any) => Number(vm.vmid) === VMID)) throw new Error(`vmid ${VMID} already exists on node ${node.nodeName}`)

  const products = await prisma.product.findMany({ where: { isActive: true, status: "active", deletedAt: null } })
  const template = await prisma.osTemplate.findFirst({
    where: { isActive: true, source: "PROXMOX", syncedFromProxmox: true, proxmoxNodeId: NODE_ID, cloudInitSupported: true, name: { in: TEMPLATE_PREFERENCE } },
    orderBy: [{ name: "asc" }],
  })
  const candidates = products
    .filter((p) => {
      const terms = Array.isArray(p.billingTerms) ? p.billingTerms.map((t) => Number(t)) : []
      return terms.includes(1)
    })
    .sort((a, b) => a.ramGb - b.ramGb || a.cpuCores - b.cpuCores || a.storageGb - b.storageGb || Number(a.price1m) - Number(b.price1m))
  const product = candidates[0] || null

  if (!product) throw new Error("No active product with a 1-month billing term found")
  if (!template || template.proxmoxVmid == null) throw new Error("No PROXMOX cloud-init template found on the node")

  const unitPrice = Number(product.price1m)
  const currency = "INR"
  const customer = await prisma.customer.create({
    data: {
      email: `test-order-${VMID}@zws.local.test`,
      name: "ZWS Test - VM 465543",
status: "ACTIVE",
      isActive: true,
      emailVerifiedAt: new Date(),
    },
  })

  const hostname = "test-465543"
  const password = "zws-test-vm-465543!" + Date.now() % 10000
  const passwordEncrypted = encryptSecret(password)

  const order = await prisma.order.create({
    data: {
      orderNumber: ORDER_NUMBER,
      customerId: customer.id,
      productId: product.id,
      termMonths: 1,
      unitPrice,
      quantity: 1,
      subtotal: unitPrice,
      taxAmount: 0,
      discountAmount: 0,
      totalAmount: unitPrice,
      originalAmount: unitPrice,
      finalAmount: unitPrice,
      payableAmount: unitPrice,
      operatingSystemId: template.id,
      osName: template.name,
      templateVmid: template.proxmoxVmid,
      proxmoxNodeId: node.id,
      hostname,
      adminUsername: "root",
      accessMethod: "PASSWORD",
      passwordEncrypted,
      currency,
      status: "paid",
      notes: "Automated test order for verification VM 465543. Not a real customer order.",
      metadata: {
        testOrder: true,
        testVm: { vmid: VMID, purpose: "verification", createdFrom: "zws-test-vm-create" },
        createdByAdmin: "script:zws-test-vm-create",
        autoProvisionEffective: true,
        autoProvisionSource: "test-script",
        provisionNodeSelection: "explicit",
        provisionNodeId: node.id,
        generatedHostname: hostname,
        adminOrderAction: "paid_activate",
      },
    },
  })

  const now = new Date()
  const farFuture = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
  await prisma.vpsInstance.create({
    data: {
      customerId: customer.id,
      orderId: order.id,
      productId: product.id,
      proxmoxNodeId: node.id,
      operatingSystemId: template.id,
      vmid: VMID,
      status: "CREATING",
      name: hostname,
      instanceName: hostname,
      hostname,
      cpuCores: product.cpuCores,
      ramGb: product.ramGb,
      diskGb: product.storageGb,
      billingCycle: "monthly",
      billingTermMonths: 1,
      renewalAmount: unitPrice,
      terminationAt: farFuture,
      deletionAt: farFuture,
      suspendAt: farFuture,
      penaltyAt: farFuture,
      renewalDueAt: farFuture,
      nextRenewalAt: farFuture,
      autoSuspendEnabled: false,
      autoDeleteEnabled: false,
      automationPausedAt: now,
      remindersPausedAt: now,
      lifecycleMetadata: { testOrder: true, vmidRequested: VMID },
    },
  })

  await prisma.proxmoxNode.update({ where: { id: node.id }, data: { lastCheckedAt: new Date() } }).catch(() => null)

  const invoice = await createInvoiceForOrder(order.id)
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      invoiceId: invoice.id,
      customerId: customer.id,
      gateway: "manual",
      amount: unitPrice,
      currency,
      status: "completed",
      purpose: "admin_created_order",
      completedAt: now,
      gatewayTransactionId: `manual:${ORDER_NUMBER}`,
      transactionId: `manual:${ORDER_NUMBER}`,
      errorMessage: "Test order marked paid by admin script",
    },
  })

  const finalized = await handlePaidInvoice(invoice.id, {
    paymentId: payment.id,
    actor: `admin:script:${ORDER_NUMBER}`,
    autoProvision: true,
    purpose: "admin_created_order",
    transactionId: `manual:${ORDER_NUMBER}`,
  })
  console.log("handlePaidInvoice ->", JSON.stringify({ finalized: finalized.finalized, reason: finalized.reason, provisioned: (finalized as any).provisioned || (finalized as any).enqueued || null }))

  await printStatus(order.id)
  console.log("Waiting for provisioning pipeline…")
  await waitForVm(node, client)
}

async function printStatus(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { vpsInstance: true, provisioningJobs: { orderBy: { createdAt: "desc" }, take: 3 } } })
  console.log(
    JSON.stringify(
      {
        orderId: order?.id,
        orderNumber: order?.orderNumber,
        orderStatus: order?.status,
        provisioningStatus: order?.provisioningStatus,
        provisioningError: order?.provisioningError,
        vmid: order?.vpsInstance?.vmid,
        vpsStatus: order?.vpsInstance?.status,
        jobs: order?.provisioningJobs?.map((job) => ({ id: job.id, status: job.status, currentStep: job.currentStep, error: job.error, vmid: job.vmid })),
      },
      null,
      2,
    ),
  )
}

async function waitForVm(node: any, client: any) {
  const deadline = Date.now() + 20 * 60 * 1000
  let lastJobPrint = ""
  let lastOrderId = ""
  while (Date.now() < deadline) {
    const order = await prisma.order.findUnique({ where: { orderNumber: ORDER_NUMBER }, include: { vpsInstance: true, provisioningJobs: { orderBy: { createdAt: "desc" }, take: 1 } } })
    if (order?.id) lastOrderId = order.id
    const job = order?.provisioningJobs?.[0]
    const state = `job=${job?.status || "none"} step=${job?.currentStep || "-"} vps=${order?.vpsInstance?.status || "-"}`
    if (state !== lastJobPrint) {
      lastJobPrint = state
      console.log(`[wait] ${new Date().toISOString()} ${state}` + (job?.error ? ` error=${job.error}` : ""))
    }
    const vms: any[] = (await client.getVMList(node.nodeName).catch(() => [])) || []
    const found = vms.find((vm: any) => Number(vm.vmid) === VMID)
    if (found) {
      console.log(`VM ${VMID} found on Proxmox (status=${found.status || "n/a"})`)
      await sleep(8000)
      const vmStatus = await client.getVMStatus(node.nodeName, VMID).catch(() => null)
      console.log(`getVMStatus: ${vmStatus ? String(vmStatus.status) : "n/a"}`)
      await printStatus(lastOrderId)
      return
    }
    if (job && ["failed"].includes(job.status)) {
      console.error(`Provisioning job FAILED: ${job.error || job.errorCode || "unknown"}`)
      await printStatus(lastOrderId)
      return
    }
    await sleep(5000)
  }
  console.error("Timed out waiting for VM provisioning")
  await printStatus(lastOrderId)
}

main().catch(async (error) => {
  console.error("FAILED:", error instanceof ProxmoxError ? error.message : error?.message || error)
  process.exit(1)
})