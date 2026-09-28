import crypto from "node:crypto"
import { prisma } from "@/lib/db"
import { createProxmoxClient } from "@/lib/proxmox"
import { createAuditLog } from "@/lib/audit-log"
import { decryptSecretValue, encryptSecretValue } from "@/lib/secret-crypto"
import { osMetadataForVps } from "@/lib/guest-automation/service"
import { ensureGuestBeforeStart, type VmContext } from "@/lib/guest-automation/first-boot"
import { enqueueVmAction, resolveVmActionTargetByVps, serializeVmActionJob } from "@/lib/vm-action-jobs"

export type VpsPowerAction = "start" | "stop" | "reboot" | "forceStop"

function generateStartPassword(length = 20) {
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+"
  const bytes = crypto.randomBytes(length)
  return Array.from(bytes, (byte) => charset[byte % charset.length]).join("")
}

async function auditGuestStartCheck(input: {
  vps: any
  actor: string
  status: "SUCCESS" | "WARN"
  observed: Record<string, unknown>
  reason: string
}) {
  await Promise.all([
    (prisma as any).vmAuditLog.create({
      data: {
        eventType: "VM_START_GUEST_CHECK",
        severity: input.status === "WARN" ? "WARNING" : "INFO",
        actorType: input.actor.startsWith("customer:") ? "USER" : "SYSTEM",
        actorEmail: input.actor,
        vpsInstanceId: input.vps.id,
        customerId: input.vps.customerId,
        orderId: input.vps.orderId,
        proxmoxNodeId: input.vps.proxmoxNodeId || null,
        vmid: input.vps.vmid || null,
        targetType: "vps_instance",
        targetId: input.vps.id,
        newValue: input.observed,
        reason: input.reason,
        status: input.status === "WARN" ? "WARNING" : "SUCCESS",
        metadata: { action: "start" },
      },
    }).catch(() => null),
    createAuditLog({
      action: "VM_START_GUEST_CHECK",
      actorEmail: input.actor,
      customerId: input.vps.customerId,
      targetType: "vps_instance",
      targetId: input.vps.id,
      newValue: input.observed,
      metadata: { status: input.status, reason: input.reason },
    }),
  ])
}

/**
 * Guarantee the guest has working credentials before a start.
 *
 * The Cloud-Init version of this rewrote `ciuser`/`cipassword`/`ipconfig0` on
 * every start. That is gone: the guest is configured once, through its own OS
 * profile, and a start must not silently re-apply anything. What remains is a
 * check — if the database has no credential for the VM, one is generated and
 * stored, and the guest's reported state is recorded for the audit trail.
 */
export async function ensureGuestCredentials(input: {
  vps: any
  ctx: VmContext
  nodeName: string
  actor?: string | null
}) {
  if (!input.vps?.passwordEncrypted) {
    const generated = generateStartPassword()
    const passwordEncrypted = encryptSecretValue(generated)
    const adminUsername = input.vps.adminUsername || input.vps.username || "root"
    await prisma.vpsInstance.update({ where: { id: input.vps.id }, data: { passwordEncrypted, username: adminUsername, adminUsername } })
    await prisma.order.update({ where: { id: input.vps.orderId }, data: { passwordEncrypted, adminUsername } }).catch(() => undefined)
  }
  if (!decryptSecretValue(String(input.vps.passwordEncrypted))) throw new Error("database_password_missing")
  return { ok: true }
}

/**
 * Pre-start guard for guest automation.
 *
 * Unlike the Cloud-Init self-heal this never writes to the VM. It records what
 * the guest currently reports so a start that follows a configuration change is
 * traceable, and it stays silent about a stopped VM because there is no agent to
 * ask yet.
 */
export async function ensureGuestBeforeStartAction(input: {
  vps: any
  ctx: VmContext
  actor?: string | null
}) {
  const actor = input.actor || "system:vm-start"
  await ensureGuestCredentials({ vps: input.vps, ctx: input.ctx, nodeName: input.ctx.nodeName, actor })
  const check = await ensureGuestBeforeStart({
    vps: input.vps,
    ctx: input.ctx,
    metadata: osMetadataForVps(input.vps),
    actor,
  })
  await auditGuestStartCheck({
    vps: input.vps,
    actor,
    status: check.checked && !check.matched ? "WARN" : "SUCCESS",
    observed: check.observed,
    reason: check.reason,
  })
  return check
}

export async function performVpsPowerAction(input: {
  vpsId: string
  action: VpsPowerAction
  customerId?: string
  requestedBy?: string
  requestedRole?: "customer" | "admin" | "api_key" | "system"
}) {
  const vps = await resolveVmActionTargetByVps({ vpsId: input.vpsId, customerId: input.customerId })
  const queued = await enqueueVmAction({
    vps,
    action: input.action,
    actor: {
      customerId: input.customerId,
      requestedBy: input.requestedBy || (input.customerId ? `customer:${input.customerId}` : "system:vps-control"),
      requestedRole: input.requestedRole || (input.customerId ? "customer" : "system"),
    },
  })
  return {
    ok: true,
    accepted: true,
    ...serializeVmActionJob(queued.job),
    vpsInstanceId: vps.id,
    proxmoxNodeId: vps.proxmoxNodeId,
    node: vps.proxmoxNode!.nodeName,
    vmid: vps.vmid,
    duplicate: queued.duplicate,
  }
}
