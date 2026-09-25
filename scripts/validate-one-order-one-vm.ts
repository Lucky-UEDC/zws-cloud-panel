import "dotenv/config"
import assert from "node:assert/strict"
import { prisma } from "@/lib/db"
import { enqueueProvisioningJob } from "@/lib/provision"
import { createProxmoxClient, PROXMOX_LONG_TIMEOUT_MS } from "@/lib/proxmox"
import { extractMetadataFromNotes } from "@/lib/proxmox-tags"

function arg(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

const requestedOrderId = arg("--order") || process.env.ONE_VM_VALIDATION_ORDER_ID
const concurrency = Math.max(2, Number(arg("--concurrency") || 10))
const webhookReplays = Math.max(0, Number(arg("--webhook-replays") || 20))
if (!requestedOrderId) throw new Error("Provide --order <paid-order-id> or ONE_VM_VALIDATION_ORDER_ID")
const orderId: string = requestedOrderId

async function main() {
  const calls = Array.from({ length: concurrency + webhookReplays }, (_, index) => enqueueProvisioningJob(orderId, `validation:replay:${index}`, { retryBlocked: true }))
  const jobs = await Promise.all(calls)
  const realJobIds = new Set(jobs.map((job: any) => String(job.id)).filter((id) => !id.startsWith("existing:")))
  assert.ok(realJobIds.size <= 1, `Expected one provisioning job, found ${Array.from(realJobIds).join(", ")}`)

  const [order, identity, activeJobs] = await Promise.all([
    prisma.order.findUnique({ where: { id: orderId }, include: { vpsInstance: true } }),
    (prisma as any).vmProvisioningIdentity.findUnique({ where: { orderId } }),
    prisma.provisioningJob.findMany({ where: { orderId, type: "provision", status: { in: ["queued", "running", "retrying", "waiting_for_admin"] } } }),
  ])
  assert.ok(order, "Order not found")
  assert.ok(identity, "Provisioning identity missing")
  assert.ok(activeJobs.length <= 1, `Expected at most one active job, found ${activeJobs.length}`)
  if (order.vpsInstance) {
    assert.equal(identity.vpsInstanceId, order.vpsInstance.id)
    assert.equal(identity.vmUuid, order.vpsInstance.id)
    assert.equal(Number(identity.vmid), Number(order.vpsInstance.vmid))
    const allocations = await prisma.ipAllocation.findMany({ where: { vpsInstanceId: order.vpsInstance.id, allocationType: "default", releasedAt: null, status: { in: ["reserved", "RESERVED", "assigned", "ASSIGNED", "used", "USED"] } } })
    assert.ok(allocations.length <= 1, `Expected one active default IP, found ${allocations.length}`)
  }

  const nodes = await prisma.proxmoxNode.findMany({ where: { isActive: true } })
  const proxmoxMatches: Array<{ node: string; vmid: number }> = []
  for (const node of nodes) {
    const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, { allowInsecureTls: node.allowInsecureTls, timeoutMs: PROXMOX_LONG_TIMEOUT_MS })
    const list = await client.getVMList(node.nodeName)
    for (const vm of list) {
      if (Number((vm as any).template || 0) === 1) continue
      const vmid = Number(vm.vmid)
      const config = await client.getVMConfig(node.nodeName, vmid).catch(() => null)
      if (config && String(extractMetadataFromNotes((config as any).description).orderId || "") === orderId) proxmoxMatches.push({ node: node.nodeName, vmid })
    }
  }
  assert.ok(proxmoxMatches.length <= 1, `Expected no more than one Proxmox VM, found ${JSON.stringify(proxmoxMatches)}`)
  console.log(JSON.stringify({ ok: true, orderId, concurrentRequests: concurrency, webhookReplays, jobIds: Array.from(realJobIds), activeJobs: activeJobs.length, vpsId: order.vpsInstance?.id || null, vmid: identity.vmid, publicIp: identity.publicIp, phase: identity.phase, proxmoxMatches }, null, 2))
}

main().finally(async () => prisma.$disconnect())
