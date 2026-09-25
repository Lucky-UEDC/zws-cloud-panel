import "dotenv/config"
import { prisma } from "@/lib/db"
import { runVmBackupTask, recoverStaleVmBackups, listPolicyBackupTargets, reconcileInProgressBackups } from "@/lib/proxmox-backup"
import { resolveBackupEntitlement, computeBackupUsageSummary, rebuildBackupUsage } from "@/lib/billing/entitlements"

const TICK_MS = 60 * 1000
// Periodic entitlement reconciliation runs every 30 ticks (~30 minutes) and is
// DB-only (never scans Proxmox storage). It keeps the persisted usage snapshot
// and overage ledger in sync with the authoritative backup inventory.
const USAGE_REBUILD_EVERY_TICKS = 30
let ticksSinceUsageRebuild = 0

function parseVmIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const ids: number[] = []
  for (const entry of value) {
    const n = Number(entry)
    if (Number.isInteger(n) && n > 0 && !ids.includes(n)) ids.push(n)
  }
  return ids
}

async function hasInflightBackup(policyId: string, vmid: number) {
  const inflight = await prisma.vmBackup.findFirst({
    where: { schedule: policyId, vmid: Number(vmid), status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "desc" },
  })
  return !!inflight
}

async function processPolicy(policy: {
  id: string
  name: string
  isEnabled: boolean
  includeVms: unknown
  scheduleMinutes: number
}) {
  const vmids = parseVmIds(policy.includeVms)
  if (vmids.length === 0) {
    console.log(`[vm-backup-scheduler] policy ${policy.id} has no VMs`)
    return
  }

  const instances = await prisma.vpsInstance.findMany({ where: { vmid: { in: vmids }, deletedAt: null }, select: { id: true, vmid: true, customerId: true } }).catch(() => [])
  const customerByVmid = new Map<number, string>()
  for (const instance of instances) customerByVmid.set(Number(instance.vmid), instance.customerId)
  const entitlementCache = new Map<string, { ok: boolean; reason?: string }>()
  async function entitlementOkForVmid(vmid: number): Promise<{ ok: boolean; reason?: string }> {
    const customerId = customerByVmid.get(vmid)
    if (!customerId) return { ok: true }
    if (entitlementCache.has(customerId)) return entitlementCache.get(customerId)!
    let result: { ok: boolean; reason?: string }
    try {
      const entitlementResult = await resolveBackupEntitlement(customerId)
      if (!entitlementResult.entitled) {
        result = { ok: false, reason: entitlementResult.reason || "no backup plan" }
      } else {
        const usage = await computeBackupUsageSummary(customerId, { entitlement: entitlementResult.entitlement })
        if (usage.capReached) result = { ok: false, reason: "backup storage cap reached" }
        else if (usage.entitled && usage.backupsRemaining !== null && usage.backupsRemaining <= 0) result = { ok: false, reason: "backup limit reached" }
        else result = { ok: true }
      }
    } catch {
      result = { ok: false, reason: "entitlement check failed" }
    }
    entitlementCache.set(customerId, result)
    return result
  }

  const results: Record<number, string> = {}
  for (const vmid of vmids) {
    try {
      const gate = await entitlementOkForVmid(vmid)
      if (!gate.ok) {
        console.log(`[vm-backup-scheduler] policy=${policy.id} vmid=${vmid} skipped: ${gate.reason}`)
        results[vmid] = "skipped"
        continue
      }
      if (await hasInflightBackup(policy.id, vmid)) {
        console.log(`[vm-backup-scheduler] policy=${policy.id} vmid=${vmid} skipped: backup already queued or running`)
        results[vmid] = "skipped"
        continue
      }
      const result = await runVmBackupTask({ policyId: policy.id, vmid, actor: "vm-backup-scheduler" })
      results[vmid] = result?.status || "failed"
    } catch (error: any) {
      console.error(`[vm-backup-scheduler] policy=${policy.id} vmid=${vmid} failed`, error?.message)
      results[vmid] = "failed"
    }
  }

  const targets = await listPolicyBackupTargets(policy.id).catch(() => [])
  const failures = Object.values(results).filter((status) => status === "failed").length
  const status = failures === 0 ? "success" : "partial"
  await prisma.vmBackupPolicy.update({
    where: { id: policy.id },
    data: {
      lastRunAt: new Date(),
      lastStatus: status,
      lastError: failures === 0 ? null : `${failures} VM(s) failed`,
      nextRunAt: new Date(Date.now() + Math.max(1, policy.scheduleMinutes) * 60 * 1000),
      metadata: {
        lastRunVms: targets,
        lastRunResults: results,
        lastRunFailureCount: failures,
      },
    },
  })

  console.log(`[vm-backup-scheduler] policy ${policy.name} done`, { vmids, status, failures })
}

function schedulePolicies() {
  return prisma.vmBackupPolicy.findMany({ where: { isEnabled: true } })
}

async function duePolicies(now: Date): Promise<Array<{ policy: any; vmids: number[] }>> {
  const policies = await schedulePolicies()
  const due: Array<{ policy: any; vmids: number[] }> = []
  for (const policy of policies) {
    const next = policy.nextRunAt ? new Date(policy.nextRunAt).getTime() : 0
    if (next <= now.getTime()) {
      due.push({ policy, vmids: parseVmIds(policy.includeVms) })
    }
  }
  return due
}

async function tick() {
  const now = new Date()

  // Server-side reconcile: backups started by the client are finalized here
  // even if the customer closed the tab. Keeps persisted state authoritative
  // and drives completion notifications without relying on browser polling.
  const reconciled = await reconcileInProgressBackups().catch((error) => {
    console.error("[vm-backup-scheduler] reconcile failed", error?.message)
    return { checked: 0, finalized: 0 }
  })
  if (reconciled.finalized > 0) {
    console.log("[vm-backup-scheduler] reconciled in-progress backups", reconciled)
  }

  await recoverStaleVmBackups(45, "vm-backup-scheduler").catch((e) => console.error("[vm-backup-scheduler] recover stale failed", e?.message))

  // Periodic safety reconciliation of backup entitlement usage (Part 4.4).
  ticksSinceUsageRebuild += 1
  if (ticksSinceUsageRebuild >= USAGE_REBUILD_EVERY_TICKS) {
    ticksSinceUsageRebuild = 0
    void rebuildBackupUsage({ persist: true })
      .then((results) => {
        const corrected = results.filter((result) => result.corrected)
        if (corrected.length) {
          console.log("[vm-backup-scheduler] backup usage reconciled", { total: results.length, corrected: corrected.length })
        }
      })
      .catch((error) => console.error("[vm-backup-scheduler] backup usage rebuild failed", error?.message))
  }

  const due = await duePolicies(now)
  if (due.length === 0) return console.log("[vm-backup-scheduler] no policies due")

  for (const { policy } of due) {
    try {
      await processPolicy(policy)
    } catch (error: any) {
      console.error(`[vm-backup-scheduler] policy ${policy.id} errored`, error?.message)
      await prisma.vmBackupPolicy
        .update({ where: { id: policy.id }, data: { lastStatus: "error", lastError: String(error?.message || "unknown"), lastRunAt: new Date(), nextRunAt: new Date(Date.now() + 60 * 1000) } })
        .catch(() => null)
    }
  }
}

async function main() {
  const once = process.argv.includes("--once")
  console.log(`[vm-backup-scheduler] starting (once=${once})`)
  await tick().catch((error) => {
    console.error("[vm-backup-scheduler] initial tick failed", error)
    if (once) process.exitCode = 1
  })
  if (once) {
    await prisma.$disconnect().catch(() => undefined)
    process.exit(process.exitCode || 0)
  }
  setInterval(() => tick().catch((error) => console.error("[vm-backup-scheduler] tick failed", error)), TICK_MS)
}

main()