import { execFile } from "node:child_process"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { prisma } from "@/lib/db"
import { assertDatabaseUrl } from "@/lib/db-url"
import { createProxmoxClient, PROXMOX_LONG_TIMEOUT_MS } from "@/lib/proxmox"
import { extractConfiguredVmIp } from "@/lib/vm-ip-discovery"
import { getEvolutionSettings, updateEvolutionSettings } from "@/lib/whatsapp/evolution"

const execFileAsync = promisify(execFile)
const apply = process.argv.includes("--apply")
const skipBackup = process.argv.includes("--skip-backup")
const TEST_RECIPIENT = "+919348487611"
const EVOLUTION_SERVER_URL = "https://web.myrdphub.com"
const EVOLUTION_INSTANCE = "production-test"

type RepairStep = {
  key: string
  title: string
  changed: number
  note?: string
  samples?: unknown[]
}

function jsonReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? Number(value) : value
}

function databaseUrlForPgDump(databaseUrl: string) {
  const url = new URL(databaseUrl)
  for (const param of ["schema", "connection_limit", "pool_timeout"]) {
    url.searchParams.delete(param)
  }
  return url.toString()
}

async function countRaw(sql: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: number | bigint | string }>>(sql)
  return Number(rows[0]?.count || 0)
}

async function backupDatabase() {
  if (!apply || skipBackup) return null
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return null
  const dir = path.join(process.cwd(), "backups", "integrity-repairs")
  await mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const file = path.join(dir, `pre-data-integrity-evolution-${stamp}.sql`)
  try {
    await execFileAsync("pg_dump", [databaseUrlForPgDump(databaseUrl), "--file", file], { timeout: 10 * 60_000 })
    return file
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Database backup failed before --apply repair: ${message}`)
  }
}

async function repairFreeAllocationOwners(): Promise<RepairStep> {
  const where = {
    status: { in: ["free", "FREE", "released", "RELEASED"] as any },
    OR: [
      { vpsInstanceId: { not: null } },
      { vmid: { not: null } },
      { hostname: { not: null } },
      { allocationLockKey: { not: null } },
      { assignedBy: { not: null } },
    ],
  }
  const samples = await prisma.ipAllocation.findMany({
    where,
    select: { id: true, ipAddress: true, status: true, vpsInstanceId: true, vmid: true, hostname: true },
    take: 20,
    orderBy: { updatedAt: "desc" },
  })
  let changed = samples.length
  if (apply) {
    const result = await prisma.ipAllocation.updateMany({
      where,
      data: {
        vpsInstanceId: null,
        vmid: null,
        hostname: null,
        allocationLockKey: null,
        assignedBy: null,
        releasedAt: new Date(),
      },
    })
    changed = result.count
  } else {
    changed = await prisma.ipAllocation.count({ where })
  }
  return { key: "free_allocation_owners", title: "Free/released allocations with stale owner fields", changed, samples }
}

async function releaseGhostAssignments(): Promise<RepairStep> {
  const countSql = `
    select count(*)::int as count
    from vm_ip_assignments a
    left join vps_instances v on v.id = a."vpsInstanceId"
    where lower(a.status) = 'active'
      and (v.id is null or v."deletedAt" is not null)
  `
  const changed = await countRaw(countSql)
  if (apply && changed > 0) {
    await prisma.$executeRawUnsafe(`
      with ghost as (
        select a.id
        from vm_ip_assignments a
        left join vps_instances v on v.id = a."vpsInstanceId"
        where lower(a.status) = 'active'
          and (v.id is null or v."deletedAt" is not null)
      )
      update vm_ip_assignments a
      set status = 'released',
          "isPrimary" = false,
          role = case when role = 'primary' then 'secondary' else role end,
          "detachedAt" = coalesce("detachedAt", now())
      from ghost
      where a.id = ghost.id
    `)
  }
  return { key: "ghost_assignments", title: "Active VM IP assignments without live VPS owner", changed }
}

async function demoteDuplicatePrimaryAssignments(): Promise<RepairStep> {
  const countSql = `
    select count(*)::int as count
    from (
      select "vpsInstanceId"
      from vm_ip_assignments
      where lower(status) = 'active'
        and family = 'ipv4'
        and ("isPrimary" = true or role = 'primary')
      group by "vpsInstanceId"
      having count(*) > 1
    ) d
  `
  const changed = await countRaw(countSql)
  if (apply && changed > 0) {
    await prisma.$executeRawUnsafe(`
      with ranked_primary as (
        select
          a.id,
          row_number() over (
            partition by a."vpsInstanceId"
            order by
              case when v."ipAddress" is not null and a."ipAddress" = v."ipAddress" then 0 else 1 end,
              case when a.role = 'primary' then 0 else 1 end,
              a."createdAt" asc
          ) as rn
        from vm_ip_assignments a
        join vps_instances v on v.id = a."vpsInstanceId"
        where lower(a.status) = 'active'
          and a.family = 'ipv4'
          and (a."isPrimary" = true or a.role = 'primary')
          and v."deletedAt" is null
      )
      update vm_ip_assignments a
      set "isPrimary" = false,
          role = 'secondary'
      from ranked_primary
      where a.id = ranked_primary.id
        and ranked_primary.rn > 1
    `)
  }
  return { key: "duplicate_primary_assignments", title: "VMs with more than one active primary IPv4", changed }
}

async function releaseDuplicateActiveIpOwners(): Promise<RepairStep> {
  const countSql = `
    select count(*)::int as count
    from (
      select "ipAddress"
      from vm_ip_assignments
      where lower(status) = 'active'
        and family = 'ipv4'
        and "ipAddress" is not null
      group by "ipAddress"
      having count(*) > 1
    ) d
  `
  const changed = await countRaw(countSql)
  if (apply && changed > 0) {
    await prisma.$executeRawUnsafe(`
      with ranked_ip as (
        select
          a.id,
          row_number() over (
            partition by a."ipAddress"
            order by
              case when v."ipAddress" = a."ipAddress" then 0 else 1 end,
              case when a."isPrimary" = true or a.role = 'primary' then 0 else 1 end,
              a."createdAt" asc
          ) as rn
        from vm_ip_assignments a
        join vps_instances v on v.id = a."vpsInstanceId"
        where lower(a.status) = 'active'
          and a.family = 'ipv4'
          and a."ipAddress" is not null
          and v."deletedAt" is null
      )
      update vm_ip_assignments a
      set status = 'released',
          "isPrimary" = false,
          role = case when role = 'primary' then 'secondary' else role end,
          "detachedAt" = coalesce("detachedAt", now())
      from ranked_ip
      where a.id = ranked_ip.id
        and ranked_ip.rn > 1
    `)
  }
  return { key: "duplicate_active_ip_owners", title: "IPv4 addresses with multiple active assignment owners", changed }
}

async function alignAssignedAllocationsToCanonicalAssignments(): Promise<RepairStep> {
  const samples = await prisma.$queryRawUnsafe<unknown[]>(`
    select
      ipa.id,
      ipa."ipAddress",
      ipa.status,
      ipa."vpsInstanceId" as "allocationVpsInstanceId",
      ipa.vmid as "allocationVmid",
      ipa.hostname as "allocationHostname",
      a.id as "assignmentId",
      a."vpsInstanceId" as "canonicalVpsInstanceId",
      coalesce(a.vmid, v.vmid) as "canonicalVmid",
      v.name as "canonicalHostname",
      v."orderId" as "canonicalOrderId"
    from ip_allocations ipa
    join vm_ip_assignments a
      on a."ipAddress" = ipa."ipAddress"
      and a.family = 'ipv4'
      and lower(a.status) = 'active'
    join vps_instances v
      on v.id = a."vpsInstanceId"
      and v."deletedAt" is null
    where lower(ipa.status) not in ('free', 'released')
      and (
        ipa."vpsInstanceId" is distinct from a."vpsInstanceId"
        or ipa.vmid is distinct from coalesce(a.vmid, v.vmid)
        or ipa."nodeId" is distinct from coalesce(a."proxmoxNodeId", v."proxmoxNodeId")
      )
    order by ipa."updatedAt" desc
    limit 20
  `)
  let changed = samples.length
  if (apply) {
    const result = await prisma.$executeRawUnsafe(`
      update ip_allocations ipa
      set
        "vpsInstanceId" = a."vpsInstanceId",
        vmid = coalesce(a.vmid, v.vmid),
        "nodeId" = coalesce(a."proxmoxNodeId", v."proxmoxNodeId"),
        hostname = v.name,
        status = 'assigned',
        "releasedAt" = null
      from vm_ip_assignments a
      join vps_instances v
        on v.id = a."vpsInstanceId"
        and v."deletedAt" is null
      where a."ipAddress" = ipa."ipAddress"
        and a.family = 'ipv4'
        and lower(a.status) = 'active'
        and lower(ipa.status) not in ('free', 'released')
        and (
          ipa."vpsInstanceId" is distinct from a."vpsInstanceId"
          or ipa.vmid is distinct from coalesce(a.vmid, v.vmid)
          or ipa."nodeId" is distinct from coalesce(a."proxmoxNodeId", v."proxmoxNodeId")
        )
    `)
    changed = Number(result)
  }
  return {
    key: "assigned_allocation_owner_mismatches",
    title: "Assigned allocation rows that disagree with active VM IP assignments",
    changed,
    samples,
  }
}

async function rebuildMissingPrimaryAssignments(): Promise<RepairStep> {
  const vms = await prisma.vpsInstance.findMany({
    where: {
      deletedAt: null,
      status: { notIn: ["DELETED", "deleted", "TERMINATED", "terminated"] as any },
      ipAddress: { not: null },
      vmIpAssignments: {
        none: {
          family: "ipv4",
          status: "active",
          OR: [{ isPrimary: true }, { role: "primary" }],
        },
      },
    },
    include: {
      ipAllocations: { include: { pool: true }, orderBy: { updatedAt: "desc" } },
      vmNetworkInterfaces: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
    },
    take: 500,
  })

  const candidates: typeof vms = []
  const conflicts: unknown[] = []
  for (const vm of vms) {
    if (!vm.ipAddress) continue
    const activeOwner = await prisma.vmIpAssignment.findFirst({
      where: {
        family: "ipv4",
        status: { in: ["active", "ACTIVE", "assigned", "ASSIGNED"] as any },
        ipAddress: vm.ipAddress,
        vpsInstanceId: { not: vm.id },
        vpsInstance: {
          deletedAt: null,
          status: { notIn: ["DELETED", "deleted", "TERMINATED", "terminated"] as any },
        },
      },
      select: {
        id: true,
        vpsInstanceId: true,
        vmid: true,
        ipAddress: true,
        role: true,
        isPrimary: true,
        vpsInstance: { select: { id: true, orderId: true, vmid: true, ipAddress: true, status: true } },
      },
    })
    if (activeOwner) {
      conflicts.push({
        type: "active_ip_owner_conflict",
        skippedVps: { id: vm.id, vmid: vm.vmid, ipAddress: vm.ipAddress, orderId: vm.orderId },
        activeOwner,
      })
      continue
    }
    candidates.push(vm)
  }

  let changed = candidates.length
  if (apply) {
    changed = 0
    for (const vm of candidates) {
      if (!vm.ipAddress) continue
      const allocation = vm.ipAllocations.find((row) => row.ipAddress === vm.ipAddress) || null
      const pool = allocation?.pool || null
      await prisma.$transaction(async (tx) => {
        const iface = await tx.vmNetworkInterface.upsert({
          where: { vpsInstanceId_name: { vpsInstanceId: vm.id, name: "net0" } },
          create: {
            vpsInstanceId: vm.id,
            proxmoxNodeId: vm.proxmoxNodeId,
            vmid: vm.vmid,
            name: "net0",
            isPrimary: true,
            bridge: pool?.bridgeOverride || pool?.bridge || null,
            vlanTag: pool?.vlanTag ?? null,
            model: "virtio",
          },
          update: {
            isPrimary: true,
            proxmoxNodeId: vm.proxmoxNodeId,
            vmid: vm.vmid,
          },
        })
        if (allocation) {
          await tx.ipAllocation.update({
            where: { id: allocation.id },
            data: { status: "assigned", vpsInstanceId: vm.id, vmid: vm.vmid, nodeId: vm.proxmoxNodeId, releasedAt: null },
          })
        }
        await tx.vmIpAssignment.create({
          data: {
            vpsInstanceId: vm.id,
            proxmoxNodeId: vm.proxmoxNodeId,
            vmid: vm.vmid,
            poolId: allocation?.poolId || null,
            interfaceId: iface.id,
            ipAllocationId: allocation?.id || null,
            family: "ipv4",
            assignmentType: "address",
            role: "primary",
            ipAddress: vm.ipAddress,
            cidr: pool?.cidr ?? null,
            gateway: pool?.gateway || null,
            bridge: pool?.bridgeOverride || pool?.bridge || null,
            vlanTag: pool?.vlanTag ?? null,
            status: "active",
            isPrimary: true,
            attachedAt: new Date(),
            metadata: { repairedBy: "repair-data-integrity-evolution", source: "vps_instances.ipAddress" } as any,
          },
        })
      })
      changed += 1
    }
  }

  return {
    key: "missing_primary_assignments",
    title: "Active VMs with vps_instances.ipAddress but no active primary assignment",
    changed,
    note: conflicts.length ? `${conflicts.length} VM/IP rows skipped because the IP already has another live active assignment.` : undefined,
    samples: [
      ...candidates.slice(0, 20).map((vm) => ({ id: vm.id, vmid: vm.vmid, ipAddress: vm.ipAddress, orderId: vm.orderId })),
      ...conflicts.slice(0, 20),
    ],
  }
}

async function inspectVmid139(): Promise<RepairStep> {
  const rows = await prisma.vpsInstance.findMany({
    where: { vmid: 139, deletedAt: null },
    include: { proxmoxNode: true, order: { select: { id: true, orderNumber: true, vmId: true, proxmoxNodeId: true } } },
  })
  const staleAllocations = await prisma.ipAllocation.findMany({
    where: {
      vmid: 139,
      ipAddress: { in: ["162.141.0.61", "162.141.0.62", "162.141.0.64", "162.141.0.65", "162.141.0.66", "162.141.0.67"] },
    },
    select: { id: true, ipAddress: true, status: true, vpsInstanceId: true, vmid: true, hostname: true },
    orderBy: { ipAddress: "asc" },
  })
  const proxmox = []
  for (const vm of rows) {
    if (!vm.proxmoxNode) continue
    const client = createProxmoxClient(vm.proxmoxNode.host, vm.proxmoxNode.tokenId, vm.proxmoxNode.tokenSecret, {
      allowInsecureTls: vm.proxmoxNode.allowInsecureTls,
      timeoutMs: PROXMOX_LONG_TIMEOUT_MS,
    })
    const config = await client.getVMConfig(vm.proxmoxNode.nodeName, vm.vmid).catch((error: any) => ({ error: error?.message || String(error) }))
    proxmox.push({
      vpsId: vm.id,
      nodeName: vm.proxmoxNode.nodeName,
      vmid: vm.vmid,
      dbIp: vm.ipAddress,
      proxmoxIp: "error" in config ? null : extractConfiguredVmIp(config),
      net0: "error" in config ? null : String((config as any).net0 || ""),
      error: "error" in config ? config.error : null,
    })
  }
  return {
    key: "vmid_139_inspection",
    title: "VMID 139 Proxmox/DB inspection",
    changed: 0,
    note: rows.length ? "VMID 139 exists in vps_instances and was inspected." : "No active vps_instances row currently has vmid 139; stale allocation rows are handled by free-allocation cleanup.",
    samples: [{ vpsRows: rows.map((vm) => ({ id: vm.id, orderId: vm.orderId, ipAddress: vm.ipAddress, nodeId: vm.proxmoxNodeId })), staleAllocations, proxmox }],
  }
}

async function repairEvolutionConfig(): Promise<RepairStep> {
  const before = await getEvolutionSettings()
  const needsUpdate = before.serverUrl !== EVOLUTION_SERVER_URL || before.instanceName !== EVOLUTION_INSTANCE || before.testRecipient !== TEST_RECIPIENT
  if (apply && needsUpdate) {
    await updateEvolutionSettings({
      serverUrl: EVOLUTION_SERVER_URL,
      instanceName: EVOLUTION_INSTANCE,
      testRecipient: TEST_RECIPIENT,
    }, "repair-data-integrity-evolution")
  }
  const after = apply ? await getEvolutionSettings() : before
  return {
    key: "evolution_runtime_config",
    title: "Evolution runtime DB config",
    changed: needsUpdate ? 1 : 0,
    samples: [{
      before: {
        serverUrl: before.serverUrl,
        instanceName: before.instanceName,
        apiKeyConfigured: Boolean(before.apiKey),
        testRecipientConfigured: Boolean(before.testRecipient),
      },
      after: {
        serverUrl: apply ? after.serverUrl : EVOLUTION_SERVER_URL,
        instanceName: apply ? after.instanceName : EVOLUTION_INSTANCE,
        apiKeyConfigured: Boolean(after.apiKey),
        testRecipient: apply ? after.testRecipient : TEST_RECIPIENT,
      },
    }],
  }
}

async function main() {
  assertDatabaseUrl()
  const backupFile = await backupDatabase()
  const steps: RepairStep[] = []
  steps.push(await repairFreeAllocationOwners())
  steps.push(await releaseGhostAssignments())
  steps.push(await demoteDuplicatePrimaryAssignments())
  steps.push(await releaseDuplicateActiveIpOwners())
  steps.push(await alignAssignedAllocationsToCanonicalAssignments())
  steps.push(await rebuildMissingPrimaryAssignments())
  steps.push(await inspectVmid139())
  steps.push(await repairEvolutionConfig())

  console.log(JSON.stringify({
    ok: true,
    mode: apply ? "apply" : "dry-run",
    backupFile,
    steps,
  }, jsonReplacer, 2))
}

main()
  .then(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
  .catch(async (error) => {
    await prisma.$disconnect().catch(() => undefined)
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2))
    process.exit(1)
  })
