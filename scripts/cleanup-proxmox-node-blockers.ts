import "dotenv/config"

import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"

/**
 * Proxmox node blocker cleanup
 * ----------------------------
 * The admin DELETE handler at app/api/admin/proxmox-nodes/[id]/route.ts blocks deletion
 * whenever the target node has live references in any of these tables:
 *   - vpsInstance            (deletedAt IS NULL)
 *   - order                  (deletedAt IS NULL)
 *   - vmActionJob            (completedAt IS NULL)
 *   - vmProvisioningIdentity (any)
 *   - duplicateVmIncident    (deletedAt IS NULL)
 *   - osTemplate             (isActive = true)
 *
 * This script resolves those blockers one class at a time. It is intentionally conservative:
 *   - Default mode is DRY-RUN. Pass --commit to write.
 *   - VPS soft-delete and order cancellation are gated behind explicit flags because they
 *     touch customer data. Migration to another node is the preferred path and is not done
 *     here -- this script only cleans up after a human decision.
 *   - Every write happens inside a prisma.$transaction and writes a panelLog row.
 *   - The script never touches the Proxmox node itself. After blockers are cleared, the
 *     operator must retry the admin DELETE endpoint.
 *
 * Usage:
 *   pnpm tsx scripts/cleanup-proxmox-node-blockers.ts --nodeId <id> [--class <cls>] [--commit] [--yes]
 *
 * Classes: vps, order, vm-job, provisioning, incident, template (default: all in order).
 * Extra flags:
 *   --allow-vps-soft-delete     enable soft-deleting vpsInstance rows (sets deletedAt = now())
 *   --allow-order-soft-delete    enable soft-deleting order rows (sets deletedAt = now(), status = "terminated")
 *   --vps-ids id1,id2           restrict VPS soft-delete to a subset
 *   --order-ids id1,id2         restrict order soft-delete to a subset
 *   --vm-job-grace-min <n>      only cancel jobs whose lease is expired or heartbeat older than n minutes (default 5)
 */

type Cls = "vps" | "order" | "vm-job" | "provisioning" | "incident" | "template"
const ALL_CLASSES: Cls[] = ["vps", "order", "vm-job", "provisioning", "incident", "template"]

function parseArgs(argv: string[]) {
  const args = new Set(argv.slice(2))
  const value = (name: string) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const list = (name: string) =>
    (value(name) || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  return {
    commit: args.has("--commit"),
    yes: args.has("--yes"),
    nodeId: value("nodeId"),
    cls: value("class") as Cls | undefined,
    allowVpsSoftDelete: args.has("--allow-vps-soft-delete"),
    allowOrderSoftDelete: args.has("--allow-order-soft-delete"),
    vpsIds: list("vps-ids"),
    orderIds: list("order-ids"),
    vmJobGraceMin: Number(value("vm-job-grace-min") || "5"),
  }
}

async function loadBlockers(nodeId: string) {
  const [vpsInstances, orders, vmActionJobs, provisioningIdentities, duplicateVmIncidents, templates] = await Promise.all([
    prisma.vpsInstance.findMany({
      where: { proxmoxNodeId: nodeId, deletedAt: null },
      select: { id: true, vmid: true, status: true, orderId: true, customerId: true, hostname: true },
    }),
    prisma.order.findMany({
      where: { proxmoxNodeId: nodeId, deletedAt: null },
      select: { id: true, orderNumber: true, status: true, customerId: true, serviceId: true },
    }),
    prisma.vmActionJob.findMany({
      where: { proxmoxNodeId: nodeId, completedAt: null },
      select: {
        id: true,
        action: true,
        status: true,
        vpsInstanceId: true,
        claimedAt: true,
        heartbeatAt: true,
        leaseExpiresAt: true,
      },
    }),
    prisma.vmProvisioningIdentity.findMany({
      where: { proxmoxNodeId: nodeId },
      select: { id: true, phase: true, vmid: true, orderId: true, vpsInstanceId: true },
    }),
    prisma.duplicateVmIncident.findMany({
      where: { proxmoxNodeId: nodeId, deletedAt: null },
      select: { id: true, vmid: true, status: true, orderId: true, vpsInstanceId: true },
    }),
    prisma.osTemplate.findMany({
      where: { proxmoxNodeId: nodeId, isActive: true },
      select: { id: true, name: true, proxmoxVmid: true, source: true, syncedFromProxmox: true },
    }),
  ])
  return { vpsInstances, orders, vmActionJobs, provisioningIdentities, duplicateVmIncidents, templates }
}

function summarize(label: string, rows: { id: string }[]) {
  return { label, count: rows.length, ids: rows.map((r) => r.id) }
}

async function ensureNode(nodeId: string) {
  const node = await prisma.proxmoxNode.findUnique({
    where: { id: nodeId },
    select: { id: true, name: true, host: true, nodeName: true, status: true },
  })
  if (!node) {
    throw new Error(`Proxmox node ${nodeId} not found`)
  }
  return node
}

function isJobCancellable(job: { status: string; claimedAt: Date | null; heartbeatAt: Date | null; leaseExpiresAt: Date | null }, graceMin: number) {
  if (job.status === "completed" || job.status === "failed") return false
  const now = Date.now()
  if (job.leaseExpiresAt && job.leaseExpiresAt.getTime() > now) {
    if (!job.heartbeatAt || job.heartbeatAt.getTime() > now - graceMin * 60_000) {
      return false
    }
  }
  if (job.claimedAt && job.claimedAt.getTime() > now - graceMin * 60_000 && !job.leaseExpiresAt) {
    return false
  }
  return true
}

async function logAction(input: { nodeId: string; className: Cls | "report"; actorEmail: string; before: unknown; after: unknown; note?: string }) {
  try {
    await createPanelLog({
      level: "warn",
      category: "SYSTEM",
      message: `node-cleanup:${input.className}`,
      actorType: "admin",
      actorEmail: input.actorEmail,
      metadata: {
        nodeId: input.nodeId,
        className: input.className,
        before: input.before,
        after: input.after,
        note: input.note || null,
      },
    })
  } catch (err) {
    console.warn(`[cleanup-proxmox-node-blockers] failed to write panelLog for ${input.className}:`, err)
  }
}

async function runClass(
  cls: Cls,
  nodeId: string,
  blockers: Awaited<ReturnType<typeof loadBlockers>>,
  flags: ReturnType<typeof parseArgs>,
  actorEmail: string,
) {
  switch (cls) {
    case "vps": {
      const rows = blockers.vpsInstances.filter((v) => (flags.vpsIds.length === 0 ? true : flags.vpsIds.includes(v.id)))
      if (rows.length === 0) return { cls, action: "noop", affected: 0 }
      if (!flags.allowVpsSoftDelete) {
        return {
          cls,
          action: "blocked",
          affected: 0,
          reason: "vps soft-delete requires --allow-vps-soft-delete",
          candidates: rows.map((r) => ({ id: r.id, vmid: r.vmid, status: r.status, orderId: r.orderId })),
        }
      }
      const linkedJobs = blockers.vmActionJobs.filter((j) => rows.some((r) => r.id === j.vpsInstanceId))
      const linkedIdentities = blockers.provisioningIdentities.filter((p) => rows.some((r) => r.id === p.vpsInstanceId))
      if (linkedJobs.length || linkedIdentities.length) {
        return {
          cls,
          action: "blocked",
          affected: 0,
          reason: `VPS rows still have ${linkedJobs.length} open job(s) and ${linkedIdentities.length} provisioning identity/identities; resolve those first`,
        }
      }
      const provisioningStatus = rows.some((r) => r.status === "PROVISIONING")
      if (provisioningStatus) {
        return {
          cls,
          action: "blocked",
          affected: 0,
          reason: "at least one VPS is still PROVISIONING; cancel the job or wait",
        }
      }
      if (!flags.commit) {
        return { cls, action: "dry-run", affected: rows.length, ids: rows.map((r) => r.id) }
      }
      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.vpsInstance.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { deletedAt: new Date() },
        })
        return updated.count
      })
      await logAction({ nodeId, className: "vps", actorEmail, before: rows.map((r) => r.id), after: { softDeleted: result } })
      return { cls, action: "soft-deleted", affected: result, ids: rows.map((r) => r.id) }
    }

    case "order": {
      const rows = blockers.orders.filter((o) => (flags.orderIds.length === 0 ? true : flags.orderIds.includes(o.id)))
      if (rows.length === 0) return { cls, action: "noop", affected: 0 }
      if (!flags.allowOrderSoftDelete) {
        return {
          cls,
          action: "blocked",
          affected: 0,
          reason: "order soft-delete requires --allow-order-soft-delete and explicit --order-ids (or reassign proxmoxNodeId to a healthy node)",
          candidates: rows.map((r) => ({ id: r.id, orderNumber: r.orderNumber, status: r.status })),
        }
      }
      if (flags.orderIds.length === 0) {
        return {
          cls,
          action: "blocked",
          affected: 0,
          reason: "refusing to bulk soft-delete orders; pass --order-ids id1,id2 to scope the action",
        }
      }
      if (!flags.commit) {
        return { cls, action: "dry-run", affected: rows.length, ids: rows.map((r) => r.id) }
      }
      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.order.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { deletedAt: new Date(), status: "terminated" },
        })
        return updated.count
      })
      await logAction({ nodeId, className: "order", actorEmail, before: rows.map((r) => r.id), after: { softDeleted: result } })
      return { cls, action: "soft-deleted", affected: result, ids: rows.map((r) => r.id) }
    }

    case "vm-job": {
      const rows = blockers.vmActionJobs
      if (rows.length === 0) return { cls, action: "noop", affected: 0 }
      const cancellable = rows.filter((j) => isJobCancellable(j, flags.vmJobGraceMin))
      const skipped = rows.filter((j) => !isJobCancellable(j, flags.vmJobGraceMin))
      if (cancellable.length === 0) {
        return {
          cls,
          action: "blocked",
          affected: 0,
          reason: `no cancellable jobs within ${flags.vmJobGraceMin}m grace; review leases manually`,
          skipped: skipped.map((j) => ({ id: j.id, action: j.action, status: j.status })),
        }
      }
      if (!flags.commit) {
        return {
          cls,
          action: "dry-run",
          affected: cancellable.length,
          ids: cancellable.map((j) => j.id),
          skipped: skipped.length,
        }
      }
      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.vmActionJob.updateMany({
          where: { id: { in: cancellable.map((j) => j.id) } },
          data: {
            status: "failed",
            errorCode: "CLEANUP_CANCELLED",
            error: `Cancelled by cleanup-proxmox-node-blockers for node ${nodeId}`,
            completedAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        })
        return updated.count
      })
      await logAction({
        nodeId,
        className: "vm-job",
        actorEmail,
        before: cancellable.map((j) => j.id),
        after: { cancelled: result, skipped: skipped.length },
      })
      return { cls, action: "cancelled", affected: result, ids: cancellable.map((j) => j.id), skipped: skipped.length }
    }

    case "provisioning": {
      const rows = blockers.provisioningIdentities
      if (rows.length === 0) return { cls, action: "noop", affected: 0 }
      if (!flags.commit) {
        return { cls, action: "dry-run", affected: rows.length, ids: rows.map((r) => r.id) }
      }
      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.vmProvisioningIdentity.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { proxmoxNodeId: null },
        })
        return updated.count
      })
      await logAction({ nodeId, className: "provisioning", actorEmail, before: rows.map((r) => r.id), after: { detached: result } })
      return { cls, action: "detached", affected: result, ids: rows.map((r) => r.id) }
    }

    case "incident": {
      const rows = blockers.duplicateVmIncidents
      if (rows.length === 0) return { cls, action: "noop", affected: 0 }
      if (!flags.commit) {
        return { cls, action: "dry-run", affected: rows.length, ids: rows.map((r) => r.id) }
      }
      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.duplicateVmIncident.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { deletedAt: new Date(), status: "DELETED", deletionError: null },
        })
        return updated.count
      })
      await logAction({ nodeId, className: "incident", actorEmail, before: rows.map((r) => r.id), after: { resolved: result } })
      return { cls, action: "resolved", affected: result, ids: rows.map((r) => r.id) }
    }

    case "template": {
      const rows = blockers.templates
      if (rows.length === 0) return { cls, action: "noop", affected: 0 }
      const offersUsingTemplates = await prisma.offer.count({
        where: {
          active: true,
          osTemplateId: { in: rows.map((r) => r.id) },
        },
      })
      if (offersUsingTemplates > 0) {
        return {
          cls,
          action: "blocked",
          affected: 0,
          reason: `${offersUsingTemplates} active offer(s) still reference these templates; re-home offers first`,
        }
      }
      if (!flags.commit) {
        return { cls, action: "dry-run", affected: rows.length, ids: rows.map((r) => r.id) }
      }
      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.osTemplate.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: {
            proxmoxNodeId: null,
            syncedFromProxmox: false,
            proxmoxVmid: null,
            isActive: false,
            source: "MANUAL",
          },
        })
        return updated.count
      })
      await logAction({ nodeId, className: "template", actorEmail, before: rows.map((r) => r.id), after: { disabled: result } })
      return { cls, action: "disabled", affected: result, ids: rows.map((r) => r.id) }
    }
  }
}

async function main() {
  const flags = parseArgs(process.argv)
  if (!flags.nodeId) {
    throw new Error("--nodeId <id> is required")
  }
  if (flags.cls && !ALL_CLASSES.includes(flags.cls)) {
    throw new Error(`--class must be one of ${ALL_CLASSES.join(", ")}`)
  }
  const actorEmail = process.env.ADMIN_EMAIL || process.env.NODE_CLEANUP_ACTOR || "ops-script@local"

  const node = await ensureNode(flags.nodeId)
  const blockers = await loadBlockers(flags.nodeId)
  const summary = {
    vps: summarize("vpsInstance", blockers.vpsInstances),
    order: summarize("order", blockers.orders),
    vmJob: summarize("vmActionJob", blockers.vmActionJobs),
    provisioning: summarize("vmProvisioningIdentity", blockers.provisioningIdentities),
    incident: summarize("duplicateVmIncident", blockers.duplicateVmIncidents),
    template: summarize("osTemplate", blockers.templates),
  }

  if (!flags.commit) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          node: { id: node.id, name: node.name, host: node.host, nodeName: node.nodeName, status: node.status },
          blockers: summary,
          flags: {
            commit: flags.commit,
            allowVpsSoftDelete: flags.allowVpsSoftDelete,
            allowOrderSoftDelete: flags.allowOrderSoftDelete,
            vpsIds: flags.vpsIds,
            orderIds: flags.orderIds,
            vmJobGraceMin: flags.vmJobGraceMin,
          },
        },
        null,
        2,
      ),
    )
    return
  }

  if (!flags.yes) {
    throw new Error("--commit requires --yes to acknowledge destructive intent")
  }

  const classes = flags.cls ? [flags.cls] : ALL_CLASSES
  const results: unknown[] = []
  for (const cls of classes) {
    const result = await runClass(cls, flags.nodeId!, blockers, flags, actorEmail)
    results.push(result)
    if ((result as { action: string }).action === "blocked") {
      console.warn(`[cleanup-proxmox-node-blockers] ${cls} blocked: ${(result as { reason?: string }).reason}`)
    }
  }

  const after = await loadBlockers(flags.nodeId)
  const afterSummary = {
    vps: after.vpsInstances.length,
    order: after.orders.length,
    vmJob: after.vmActionJobs.length,
    provisioning: after.provisioningIdentities.length,
    incident: after.duplicateVmIncidents.length,
    template: after.templates.length,
  }

  await logAction({
    nodeId: flags.nodeId,
    className: "report",
    actorEmail,
    before: summary,
    after: afterSummary,
    note: "full cleanup pass",
  })

  console.log(
    JSON.stringify(
      {
        mode: "commit",
        node: { id: node.id, name: node.name, host: node.host, nodeName: node.nodeName, status: node.status },
        results,
        remainingBlockers: afterSummary,
        nextStep:
          afterSummary.vps === 0 &&
          afterSummary.order === 0 &&
          afterSummary.vmJob === 0 &&
          afterSummary.provisioning === 0 &&
          afterSummary.incident === 0 &&
          afterSummary.template === 0
            ? "DELETE /api/admin/proxmox-nodes/" + flags.nodeId
            : "re-run with --class <remaining>",
      },
      null,
      2,
    ),
  )
}

main()
  .then(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error("[cleanup-proxmox-node-blockers] failed", err)
    await prisma.$disconnect().catch(() => null)
    process.exit(1)
  })
