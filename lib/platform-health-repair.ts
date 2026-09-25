import { repairPaidOrdersMissingVmLinks, scanVmInfrastructure } from "@/lib/admin-vm-management"
import { recoverStaleBackupRuns } from "@/lib/backups"
import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"
import { recoverProvisionableOrders } from "@/lib/provisioning-order-recovery"
import { runVmNetworkValidationWorker } from "@/lib/vm-network-orchestrator"

export type PlatformHealthRepairResult = {
  checkedAt: string
  actor: string
  steps: Array<{ key: string; ok: boolean; repaired?: number; skipped?: number; failed?: number; result?: unknown; error?: string }>
  repaired: number
  skipped: number
  failed: number
}

function count(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

async function runStep(key: string, fn: () => Promise<any>) {
  try {
    const result = await fn()
    const repaired = count(result?.repaired ?? result?.summary?.repairable ?? result?.summary?.repaired)
    const skipped = count(result?.skipped ?? result?.summary?.skipped)
    const failed = count(result?.failed ?? result?.summary?.failed ?? result?.rows?.filter?.((row: any) => row.status === "error")?.length)
    return { key, ok: failed === 0, repaired, skipped, failed, result }
  } catch (error) {
    return { key, ok: false, repaired: 0, skipped: 0, failed: 1, error: error instanceof Error ? error.message : String(error) }
  }
}

async function recoverStaleProvisioningQueues(input: { actor: string; maxAgeMinutes?: number; limit?: number }) {
  const maxAgeMinutes = Math.max(30, Number(input.maxAgeMinutes || 240))
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000)
  const rows = await prisma.provisioningJob.findMany({
    where: {
      status: { in: ["queued", "running", "retrying"] },
      updatedAt: { lt: cutoff },
      type: { in: ["provision", "reinstall", "terminate", "metrics", "backup"] },
    },
    select: { id: true, orderId: true, vpsInstanceId: true, type: true, updatedAt: true },
    take: Math.max(1, Math.min(Number(input.limit || 50), 200)),
  }).catch(() => [])
  for (const row of rows) {
    await prisma.provisioningJob.update({
      where: { id: row.id },
      data: {
        status: "failed",
        errorCode: "STALE_QUEUE_RECOVERY",
        error: `Marked failed by stale queue recovery after ${maxAgeMinutes} minutes.`,
        displayStatus: "Recovered stale queue item",
        completedAt: new Date(),
        metadata: { recoveredBy: input.actor, recoveredAt: new Date().toISOString(), previousUpdatedAt: row.updatedAt, type: row.type } as any,
      },
    }).catch(() => null)
  }
  return { repaired: rows.length, staleJobIds: rows.map((row) => row.id), maxAgeMinutes }
}

export async function runPlatformHealthRepair(input: { actorEmail?: string | null; limit?: number; auto?: boolean } = {}): Promise<PlatformHealthRepairResult> {
  const actor = input.actorEmail || (input.auto ? "system:platform-health-repair" : "admin:platform-health-repair")
  const limit = Math.max(1, Math.min(Number(input.limit || 50), 200))
  const steps = []

  steps.push(await runStep("recover_provisionable_orders", () => recoverProvisionableOrders({ actor, limit })))
  steps.push(await runStep("repair_missing_vm_links", () => repairPaidOrdersMissingVmLinks({ actorEmail: actor, limit })))
	  steps.push(await runStep("repair_vm_infrastructure", () => scanVmInfrastructure({ actorEmail: actor, repair: true })))
	  steps.push(await runStep("repair_vm_network", () => runVmNetworkValidationWorker({ actor, limit, autoRepair: true })))
	  steps.push(await runStep("recover_stale_backup_runs", () => recoverStaleBackupRuns({ actor, maxAgeMinutes: 180 })))
	  steps.push(await runStep("recover_stale_queue_jobs", () => recoverStaleProvisioningQueues({ actor, limit, maxAgeMinutes: 240 })))

  const summary: PlatformHealthRepairResult = {
    checkedAt: new Date().toISOString(),
    actor,
    steps,
    repaired: steps.reduce((sum, step) => sum + count(step.repaired), 0),
    skipped: steps.reduce((sum, step) => sum + count(step.skipped), 0),
    failed: steps.reduce((sum, step) => sum + count(step.failed), 0),
  }
  await createPanelLog({
    category: "System",
    message: input.auto ? "platform_health_auto_repair_completed" : "platform_health_repair_completed",
    actorType: input.auto ? "system" : "admin",
    actorEmail: input.auto ? null : actor,
    metadata: summary as any,
  }).catch(() => null)
  return summary
}
