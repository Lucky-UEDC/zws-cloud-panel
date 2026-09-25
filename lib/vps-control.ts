import crypto from "node:crypto"
import { prisma } from "@/lib/db"
import { createProxmoxClient } from "@/lib/proxmox"
import { createAuditLog } from "@/lib/audit-log"
import { decryptSecretValue, encryptSecretValue } from "@/lib/secret-crypto"
import { buildCloudInitConfig, validateCloudInitDump } from "@/lib/cloud-init-config"
import { hostnameFromIp } from "@/lib/vm-hostname"
import { enqueueVmAction, resolveVmActionTargetByVps, serializeVmActionJob } from "@/lib/vm-action-jobs"

export type VpsPowerAction = "start" | "stop" | "reboot" | "forceStop"

function parseIpConfig0(value: unknown) {
  const raw = String(value || "").trim()
  if (!raw) return { ip: null as string | null, gateway: null as string | null }
  let ip: string | null = null
  let gateway: string | null = null
  for (const part of raw.split(",").map((item) => item.trim())) {
    if (part.startsWith("ip=")) {
      const addr = part.slice(3).split("/")[0]
      if (addr && addr !== "dhcp") ip = addr
    }
    if (part.startsWith("gw=")) gateway = part.slice(3).trim() || null
  }
  return { ip, gateway }
}

function generateStartPassword(length = 20) {
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+"
  const bytes = crypto.randomBytes(length)
  return Array.from(bytes, (byte) => charset[byte % charset.length]).join("")
}

function hasCloudInitDrive(config: Record<string, any> | null | undefined) {
  return Object.keys(config || {}).some((key) => /^(ide\d+|scsi\d+|sata\d+)$/i.test(key) && String((config as any)[key] || "").toLowerCase().includes("cloudinit"))
}

function nameserverContains(current: unknown, expected: string) {
  const values = String(current || "").split(/[,\s]+/).map((value) => value.trim()).filter(Boolean)
  return String(expected || "").split(/[,\s]+/).map((value) => value.trim()).filter(Boolean).every((value) => values.includes(value))
}

async function auditVmStartSelfHeal(input: {
  vps: any
  actor: string
  status: "SUCCESS" | "ERROR"
  changes: Record<string, unknown>
  error?: string | null
}) {
  await Promise.all([
    (prisma as any).vmAuditLog.create({
      data: {
        eventType: "VM_START_SELF_HEAL",
        severity: input.status === "ERROR" ? "ERROR" : "INFO",
        actorType: input.actor.startsWith("customer:") ? "USER" : "SYSTEM",
        actorEmail: input.actor,
        vpsInstanceId: input.vps.id,
        customerId: input.vps.customerId,
        orderId: input.vps.orderId,
        proxmoxNodeId: input.vps.proxmoxNodeId || null,
        vmid: input.vps.vmid || null,
        targetType: "vps_instance",
        targetId: input.vps.id,
        newValue: input.changes,
        reason: input.error || "Self-healed missing Cloud-Init values before VM start.",
        status: input.status,
        metadata: { action: "start" },
      },
    }).catch(() => null),
    createAuditLog({
      action: "VM_START_SELF_HEAL",
      actorEmail: input.actor,
      customerId: input.vps.customerId,
      targetType: "vps_instance",
      targetId: input.vps.id,
      newValue: input.changes,
      metadata: { status: input.status, error: input.error || null },
    }),
  ])
}

async function selfHealBeforeStart(input: {
  vps: any
  client: ReturnType<typeof createProxmoxClient>
  nodeName: string
  actor: string
}) {
  const [assignment, config] = await Promise.all([
    (prisma as any).ipAssignment.findFirst({
      where: {
        vpsInstanceId: input.vps.id,
        isPrimary: true,
        status: { in: ["active", "assigned", "used", "reserved", "pending", "moved"] },
      },
      orderBy: [{ assignmentDate: "desc" }, { createdAt: "desc" }],
    }).catch(() => null),
    input.client.getVMConfig(input.nodeName, input.vps.vmid).catch(() => null),
  ])
  if (!config) throw new Error("cloud_init_verify_config_unavailable")
  if (!assignment?.assignedIp) throw new Error("assigned_ip_missing_in_database")
  if (!assignment.gateway) throw new Error("assigned_ip_gateway_missing_in_database")
  if (!assignment.dns) throw new Error("assigned_ip_dns_missing_in_database")

  const assignedIp = String(assignment.assignedIp)
  const gateway = String(assignment.gateway)
  const cidr = Number(assignment.cidr || 24)
  const dns = String(assignment.dns)
  let passwordEncrypted = input.vps.passwordEncrypted ? String(input.vps.passwordEncrypted) : ""
  if (!passwordEncrypted) {
    const generated = generateStartPassword()
    passwordEncrypted = encryptSecretValue(generated)
    const adminUsername = input.vps.adminUsername || input.vps.username || "root"
    await prisma.vpsInstance.update({ where: { id: input.vps.id }, data: { passwordEncrypted, username: adminUsername, adminUsername } })
    await prisma.order.update({ where: { id: input.vps.orderId }, data: { passwordEncrypted, adminUsername } }).catch(() => undefined)
  }
  const password = decryptSecretValue(passwordEncrypted)
  if (!password) throw new Error("database_password_missing")
  const ipconfig = parseIpConfig0(config.ipconfig0)
  const patch: Record<string, any> = {}
  const changes: Record<string, unknown> = {}
  const username = String(input.vps.adminUsername || input.vps.username || config.ciuser || "root")
  const hostname = hostnameFromIp(assignedIp) || String(input.vps.hostname || config.name || input.vps.name || `vm-${input.vps.vmid}`)
  const built = buildCloudInitConfig({
    vmid: input.vps.vmid,
    osFamily: input.vps.vmOsFamily || input.vps.operatingSystem?.name || input.vps.order?.osName || null,
    username,
    password,
    hostname,
    ip: assignedIp,
    cidr: Number.isInteger(cidr) ? cidr : 24,
    gateway,
    dns,
    searchDomain: String(config.searchdomain || "localdomain"),
  })

  if (ipconfig.ip !== assignedIp || ipconfig.gateway !== gateway) {
    patch.ipconfig0 = built.verification.expectedIpConfig
    changes.ipconfig0 = "injected_from_database"
  }
  if (!String(config.cipassword || "").trim()) {
    patch.cipassword = password
    changes.cipassword = "injected_from_database"
  }
  if (!nameserverContains(config.nameserver, dns)) {
    patch.nameserver = dns
    changes.nameserver = "injected_from_database"
  }
  if (!String(config.ciuser || "").trim()) {
    patch.ciuser = username
    changes.ciuser = "injected_from_database"
  }
  if (String(config.searchdomain || "").trim() !== built.verification.expectedSearchDomain) {
    patch.searchdomain = built.verification.expectedSearchDomain
    changes.searchdomain = "injected_from_database"
  }
  if (hostname && !String(config.name || "").trim()) {
    patch.name = hostname
    changes.name = "injected_from_database"
  }
  if (!hasCloudInitDrive(config)) {
    patch.ide2 = built.config.ide2
    patch.citype = built.config.citype
    changes.cloudInitDrive = "injected_from_database"
  }

  try {
    if (Object.keys(patch).length) await input.client.updateVMConfig(input.nodeName, input.vps.vmid, patch)
    await input.client.updateCloudInit(input.nodeName, input.vps.vmid)
    const [userDump, networkDump, verified] = await Promise.all([
      input.client.dumpCloudInit(input.nodeName, input.vps.vmid, "user"),
      input.client.dumpCloudInit(input.nodeName, input.vps.vmid, "network"),
      input.client.getVMConfig(input.nodeName, input.vps.vmid),
    ])
    const validation = validateCloudInitDump({ built, userDump, networkDump, vmConfig: verified })
    if (!validation.ok) throw new Error(`cloud_init_verify_failed:${validation.missing.join(",")}`)
    const finalIpconfig = parseIpConfig0((verified as any)?.ipconfig0)
    if (!String((verified as any)?.cipassword || "").trim()) throw new Error("cloud_init_verify_missing_cipassword")
    if (finalIpconfig.ip !== assignedIp) throw new Error("cloud_init_verify_wrong_ipconfig0")
    if (finalIpconfig.gateway !== gateway) throw new Error("cloud_init_verify_wrong_gateway")
    if (!nameserverContains((verified as any)?.nameserver, dns)) throw new Error("cloud_init_verify_missing_nameserver")
    await auditVmStartSelfHeal({ vps: input.vps, actor: input.actor, status: "SUCCESS", changes: { ...changes, verified: true, checks: ["qm cloudinit dump user", "qm cloudinit dump network", "qm config", "cloud-init drive"] } })
  } catch (error: any) {
    await auditVmStartSelfHeal({ vps: input.vps, actor: input.actor, status: "ERROR", changes, error: error?.message || String(error) })
    throw error
  }
}

export async function ensureCloudInitBeforeStart(input: {
  vps: any
  client: ReturnType<typeof createProxmoxClient>
  nodeName: string
  actor?: string | null
}) {
  return selfHealBeforeStart({
    vps: input.vps,
    client: input.client,
    nodeName: input.nodeName,
    actor: input.actor || "system:vm-start",
  })
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
