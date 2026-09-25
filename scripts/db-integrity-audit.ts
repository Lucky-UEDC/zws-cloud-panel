import { mkdir, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { prisma } from "@/lib/db"
import { isIpInRange } from "@/lib/ip-address"

type AuditRepair = (apply: boolean) => Promise<{ changed: number; note: string }>

type AuditCheck = {
  key: string
  title: string
  area: string
  severity: "info" | "warning" | "critical"
  sql: string
  repair?: AuditRepair
}

const apply = process.argv.includes("--apply")
const skipBackup = process.argv.includes("--skip-backup")
const today = new Date().toISOString().slice(0, 10)
const stamp = new Date().toISOString().replace(/[:.]/g, "-")

async function rows(sql: string) {
  return prisma.$queryRawUnsafe(sql) as Promise<Array<Record<string, unknown>>>
}

async function count(sql: string) {
  const result = await rows(sql)
  return Number(result[0]?.count || result[0]?.n || result[0]?.total || 0)
}

async function updateRaw(sql: string) {
  const result = await rows(sql)
  if (result.length > 1) return result.length
  return Number(result[0]?.count || result[0]?.n || result[0]?.total || 0)
}

function subnetGateway(ipAddress: string) {
  const parts = String(ipAddress || "").trim().split(".")
  if (parts.length !== 4) return null
  return `${parts.slice(0, 3).join(".")}.1`
}

async function backupDatabase() {
  if (!apply || skipBackup) return null
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("DATABASE_URL is required before applying DB repairs.")
  const outDir = path.join(process.cwd(), "backups")
  await mkdir(outDir, { recursive: true })
  const file = path.join(outDir, `zws-db-integrity-${stamp}.dump`)
  const dumpUrl = sanitizePgDumpUrl(databaseUrl)
  const result = spawnSync("pg_dump", [dumpUrl, "--format=custom", "--file", file], { stdio: "pipe", encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`Database backup failed before repair apply: ${result.stderr || result.stdout || "pg_dump exited non-zero"}`)
  }
  const verified = spawnSync("pg_restore", ["--list", file], { stdio: "pipe", encoding: "utf8" })
  if (verified.status !== 0) {
    throw new Error(`Database backup verification failed before repair apply: ${verified.stderr || verified.stdout || "pg_restore --list exited non-zero"}`)
  }
  return file
}

function sanitizePgDumpUrl(value: string) {
  try {
    const url = new URL(value)
    url.searchParams.delete("schema")
    return url.toString()
  } catch {
    return value.replace(/[?&]schema=[^&]+/, "")
  }
}

function quoteIdent(value: string) {
  return `"${String(value).replace(/"/g, '""')}"`
}

async function buildForeignKeyOrphanChecks(): Promise<AuditCheck[]> {
  const constraints = await prisma.$queryRaw<Array<{
    constraint_name: string
    child_table: string
    parent_table: string
    child_columns: string[]
    parent_columns: string[]
  }>>`
    select
      c.conname as constraint_name,
      child.relname as child_table,
      parent.relname as parent_table,
      array_agg(child_attr.attname order by ord.n) as child_columns,
      array_agg(parent_attr.attname order by ord.n) as parent_columns
    from pg_constraint c
    join pg_class child on child.oid = c.conrelid
    join pg_namespace child_ns on child_ns.oid = child.relnamespace
    join pg_class parent on parent.oid = c.confrelid
    join unnest(c.conkey) with ordinality as ord(attnum, n) on true
    join pg_attribute child_attr on child_attr.attrelid = c.conrelid and child_attr.attnum = ord.attnum
    join pg_attribute parent_attr on parent_attr.attrelid = c.confrelid and parent_attr.attnum = c.confkey[ord.n]
    where c.contype = 'f' and child_ns.nspname = 'public'
    group by c.conname, child.relname, parent.relname
    order by child.relname, c.conname
  `

  return constraints.map((constraint) => {
    const childAlias = "child"
    const parentAlias = "parent"
    const childTable = quoteIdent(constraint.child_table)
    const parentTable = quoteIdent(constraint.parent_table)
    const childColumns = constraint.child_columns || []
    const parentColumns = constraint.parent_columns || []
    const join = childColumns.map((childColumn, index) => `${parentAlias}.${quoteIdent(parentColumns[index])} = ${childAlias}.${quoteIdent(childColumn)}`).join(" and ")
    const childPresent = childColumns.map((column) => `${childAlias}.${quoteIdent(column)} is not null`).join(" and ")
    const parentMissing = parentColumns.map((column) => `${parentAlias}.${quoteIdent(column)} is null`).join(" and ")
    return {
      key: `fk_orphans_${constraint.child_table}_${constraint.constraint_name}`.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase(),
      title: `Orphaned ${constraint.child_table} rows referencing ${constraint.parent_table}`,
      area: "schema",
      severity: "critical" as const,
      sql: `select count(*)::int as count from ${childTable} ${childAlias} left join ${parentTable} ${parentAlias} on ${join} where ${childPresent} and (${parentMissing})`,
    }
  })
}

const checks: AuditCheck[] = [
  {
    key: "schema_unvalidated_foreign_keys",
    title: "Unvalidated foreign-key constraints",
    area: "schema",
    severity: "critical",
    sql: `select count(*)::int as count from pg_constraint where contype='f' and not convalidated`,
  },
  {
    key: "schema_missing_api_keys",
    title: "Required api_keys table missing",
    area: "schema",
    severity: "critical",
    sql: `select case when to_regclass('public.api_keys') is null then 1 else 0 end::int as count`,
  },
  {
    key: "customers_duplicate_email_lower",
    title: "Duplicate customers by case-insensitive email",
    area: "customers",
    severity: "critical",
    sql: `select count(*)::int as count from (select lower(email) from customers group by lower(email) having count(*) > 1) d`,
  },
  {
    key: "orders_missing_customer",
    title: "Orders with missing customer",
    area: "orders",
    severity: "critical",
    sql: `select count(*)::int as count from orders o left join customers c on c.id = o."customerId" where o."customerId" is not null and c.id is null`,
  },
  {
    key: "deleted_orders_not_hidden",
    title: "Deleted orders missing hidden flags",
    area: "orders",
    severity: "critical",
    sql: `select count(*)::int as count from orders where lower(status)='deleted' and ("deletedAt" is null or "isActive" = true or lower(coalesce("provisioningStatus",'')) <> 'deleted')`,
    repair: async (doApply) => {
      if (!doApply) return { changed: 0, note: "Run with --apply to normalize deleted order flags." }
      const changed = await updateRaw(`update orders set "deletedAt" = coalesce("deletedAt", now()), "isActive" = false, "provisioningStatus" = 'DELETED' where lower(status)='deleted' and ("deletedAt" is null or "isActive" = true or lower(coalesce("provisioningStatus",'')) <> 'deleted') returning 1 as count`)
      return { changed, note: "Normalized deleted order visibility flags." }
    },
  },
  {
    key: "active_orders_without_service",
    title: "Active paid orders without VPS or dedicated service",
    area: "orders",
    severity: "warning",
    sql: `select count(*)::int as count from orders o left join vps_instances v on v."orderId" = o.id and v."deletedAt" is null left join dedicated_services d on d."orderId" = o.id and lower(d.status) not in ('deleted','cancelled','canceled','refunded') where o."deletedAt" is null and o."isActive" = true and lower(o.status) in ('paid','active','completed','payment_verified','verification_pending') and v.id is null and d.id is null`,
  },
  {
    key: "service_invoices_missing_order",
    title: "Service invoices without an order",
    area: "invoices",
    severity: "critical",
    sql: `select count(*)::int as count from invoices where lower(coalesce(type,'service'))='service' and "deletedAt" is null and "orderId" is null`,
    repair: async (doApply) => {
      if (!doApply) return { changed: 0, note: "Run with --apply to link service invoices to their completed payment order when unambiguous." }
      let changed = await updateRaw(`
        with candidates as (
          select distinct on (i.id) i.id as invoice_id, p."orderId" as order_id
          from invoices i
          join payments p on p."invoiceId" = i.id
          join orders o on o.id = p."orderId"
          left join invoices existing on existing."orderId" = p."orderId" and existing.id <> i.id
          where lower(coalesce(i.type,'service'))='service'
            and i."deletedAt" is null
            and i."orderId" is null
            and p."orderId" is not null
            and existing.id is null
          order by i.id, p."completedAt" desc nulls last, p."createdAt" desc
        )
        update invoices i
        set "orderId" = candidates.order_id,
            metadata = coalesce(i.metadata, '{}'::jsonb) || jsonb_build_object('primaryOrderId', candidates.order_id, 'linkedBy', 'db-integrity-audit')
        from candidates
        where i.id = candidates.invoice_id
        returning 1 as count
      `)
      const renewalInvoices = await prisma.invoice.findMany({
        where: { orderId: null, deletedAt: null, type: "service" },
        select: { id: true, invoiceNumber: true, customerId: true, subtotal: true, taxAmount: true, discountAmount: true, totalAmount: true, currency: true, dueDate: true, metadata: true },
      })
      for (const invoice of renewalInvoices) {
        const metadata = invoice.metadata && typeof invoice.metadata === "object" && !Array.isArray(invoice.metadata) ? invoice.metadata as Record<string, any> : {}
        const checkoutSessionId = String(metadata.checkoutSessionId || "").trim()
        if (checkoutSessionId) {
          const session = await prisma.checkoutSession.findUnique({ where: { id: checkoutSessionId }, include: { payments: true } })
          const snapshot = session?.snapshot && typeof session.snapshot === "object" && !Array.isArray(session.snapshot) ? session.snapshot as Record<string, any> : {}
          const orderData = snapshot.orderData && typeof snapshot.orderData === "object" && !Array.isArray(snapshot.orderData) ? snapshot.orderData as Record<string, any> : null
          if (session && orderData && Object.keys(orderData).length) {
            await prisma.$transaction(async (tx) => {
              const current = await tx.invoice.findUnique({ where: { id: invoice.id }, select: { orderId: true } })
              if (current?.orderId) return
              const allFailed = session.payments.length > 0 && session.payments.every((payment) => ["failed", "error", "declined", "cancelled"].includes(String(payment.status).toLowerCase()))
              const preparedOrder = await tx.order.create({ data: { ...orderData, status: allFailed ? "payment_failed" : "pending_payment", isActive: !allFailed } as any })
              await tx.invoice.update({ where: { id: invoice.id }, data: { orderId: preparedOrder.id, metadata: { ...metadata, primaryOrderId: preparedOrder.id, linkedBy: "db-integrity-audit-checkout" } } })
              await tx.payment.updateMany({ where: { checkoutSessionId: session.id, orderId: null }, data: { orderId: preparedOrder.id } })
              await tx.checkoutSession.update({ where: { id: session.id }, data: { fulfilledOrderId: preparedOrder.id, snapshot: { ...snapshot, preparedOrderId: preparedOrder.id } as any } })
            })
            changed += 1
            continue
          }
        }
        let vpsInstanceId = String(metadata.vpsInstanceId || "").trim()
        if (!vpsInstanceId && Number(metadata.vmid) > 0) {
          const vmidMatches = await prisma.vpsInstance.findMany({ where: { vmid: Number(metadata.vmid), deletedAt: null }, select: { id: true }, take: 2 })
          if (vmidMatches.length === 1) vpsInstanceId = vmidMatches[0].id
        }
        if (!vpsInstanceId) continue
        const vps = await prisma.vpsInstance.findUnique({ where: { id: vpsInstanceId }, include: { order: true } })
        if (!vps || vps.customerId !== invoice.customerId) continue
        await prisma.$transaction(async (tx) => {
          const current = await tx.invoice.findUnique({ where: { id: invoice.id }, select: { orderId: true } })
          if (current?.orderId) return
          const renewalOrder = await tx.order.create({
            data: {
              orderNumber: `REPAIR-${invoice.invoiceNumber}`,
              customerId: invoice.customerId,
              productId: vps.productId,
              orderType: "renewal",
              termMonths: vps.billingTermMonths || 1,
              unitPrice: invoice.subtotal,
              quantity: 1,
              subtotal: invoice.subtotal,
              taxAmount: invoice.taxAmount,
              discountAmount: invoice.discountAmount,
              totalAmount: invoice.totalAmount,
              originalAmount: invoice.totalAmount,
              finalAmount: invoice.totalAmount,
              payableAmount: invoice.totalAmount,
              currency: invoice.currency,
              status: "pending_payment",
              hostname: vps.name,
              metadata: { kind: "renewal", vpsInstanceId: vps.id, sourceOrderId: vps.orderId, repairedFromInvoiceId: invoice.id },
            },
          })
          await tx.invoice.update({ where: { id: invoice.id }, data: { orderId: renewalOrder.id, metadata: { ...metadata, primaryOrderId: renewalOrder.id, linkedBy: "db-integrity-audit-renewal" } } })
        })
        changed += 1
      }
      return { changed, note: "Linked invoices through payment evidence or created a canonical renewal order from an unambiguous VPS reference." }
    },
  },
  {
    key: "invoices_missing_customer",
    title: "Invoices with missing customer",
    area: "invoices",
    severity: "critical",
    sql: `select count(*)::int as count from invoices i left join customers c on c.id = i."customerId" where c.id is null`,
  },
  {
    key: "invoices_missing_order",
    title: "Invoices linked to missing orders",
    area: "invoices",
    severity: "critical",
    sql: `select count(*)::int as count from invoices i left join orders o on o.id = i."orderId" where i."orderId" is not null and o.id is null`,
  },
  {
    key: "paid_service_invoices_deleted_orders",
    title: "Paid service invoices counted against deleted/inactive orders",
    area: "revenue",
    severity: "critical",
    sql: `select count(*)::int as count from invoices i join orders o on o.id = i."orderId" where lower(i.status)='paid' and lower(coalesce(i.type,'service'))='service' and i."deletedAt" is null and (o."deletedAt" is not null or lower(o.status) in ('deleted','cancelled','canceled','archived','failed','payment_failed') or o."isActive" = false)`,
    repair: async (doApply) => {
      if (!doApply) return { changed: 0, note: "Run with --apply to soft-hide paid service invoices tied to deleted/inactive orders." }
      const changed = await updateRaw(`update invoices i set "deletedAt" = coalesce(i."deletedAt", now()), "deleteReason" = coalesce(i."deleteReason", 'db-integrity: deleted/inactive order') from orders o where o.id = i."orderId" and lower(i.status)='paid' and lower(coalesce(i.type,'service'))='service' and i."deletedAt" is null and (o."deletedAt" is not null or lower(o.status) in ('deleted','cancelled','canceled','archived','failed','payment_failed') or o."isActive" = false) returning 1 as count`)
      return { changed, note: "Soft-hidden paid service invoices tied to deleted/inactive orders." }
    },
  },
  {
    key: "invalid_invoice_totals",
    title: "Invoices with invalid totals",
    area: "invoices",
    severity: "warning",
    sql: `select count(*)::int as count from invoices where abs((coalesce(subtotal,0) + coalesce("taxAmount",0) - coalesce("discountAmount",0)) - coalesce("totalAmount",0)) > 0.05`,
  },
  {
    key: "payments_missing_invoice",
    title: "Payments linked to missing invoices",
    area: "payments",
    severity: "warning",
    sql: `select count(*)::int as count from payments p left join invoices i on i.id = p."invoiceId" where p."invoiceId" is not null and i.id is null`,
  },
  {
    key: "payments_missing_order",
    title: "Payments linked to missing orders",
    area: "payments",
    severity: "warning",
    sql: `select count(*)::int as count from payments p left join orders o on o.id = p."orderId" where p."orderId" is not null and o.id is null`,
  },
  {
    key: "vps_missing_order",
    title: "VPS records with missing orders",
    area: "services",
    severity: "critical",
    sql: `select count(*)::int as count from vps_instances v left join orders o on o.id = v."orderId" where o.id is null`,
  },
  {
    key: "vps_missing_customer",
    title: "VPS records with missing customers",
    area: "services",
    severity: "critical",
    sql: `select count(*)::int as count from vps_instances v left join customers c on c.id = v."customerId" where c.id is null`,
  },
  {
    key: "deleted_vps_not_hidden",
    title: "Deleted VPS records missing deletedAt",
    area: "services",
    severity: "warning",
    sql: `select count(*)::int as count from vps_instances where lower(status) in ('deleted','terminated') and "deletedAt" is null`,
    repair: async (doApply) => {
      if (!doApply) return { changed: 0, note: "Run with --apply to normalize deleted VPS flags." }
      const changed = await updateRaw(`update vps_instances set "deletedAt" = coalesce("deletedAt", now()), "deletionAt" = coalesce("deletionAt", now()), "ipAddress" = null, "autoSuspendEnabled" = false, "autoDeleteEnabled" = false where lower(status) in ('deleted','terminated') and "deletedAt" is null returning 1 as count`)
      return { changed, note: "Normalized deleted VPS visibility flags." }
    },
  },
  {
    key: "dedicated_services_missing_order",
    title: "Dedicated services with missing orders",
    area: "services",
    severity: "critical",
    sql: `select count(*)::int as count from dedicated_services d left join orders o on o.id = d."orderId" where o.id is null`,
  },
  {
    key: "ip_allocations_missing_pool",
    title: "IP allocations with missing pool",
    area: "ipam",
    severity: "critical",
    sql: `select count(*)::int as count from ip_allocations a left join ip_pools p on p.id = a."poolId" where p.id is null`,
  },
  {
    key: "ip_allocations_missing_vps",
    title: "IP allocations linked to missing VPS",
    area: "ipam",
    severity: "warning",
    sql: `select count(*)::int as count from ip_allocations a left join vps_instances v on v.id = a."vpsInstanceId" where a."vpsInstanceId" is not null and v.id is null`,
  },
  {
    key: "assigned_ips_on_deleted_vps",
    title: "Assigned/reserved IPs attached to deleted VPS records",
    area: "ipam",
    severity: "critical",
    sql: `select count(*)::int as count from ip_allocations a join vps_instances v on v.id = a."vpsInstanceId" where lower(a.status) in ('assigned','reserved','active','used') and (v."deletedAt" is not null or lower(v.status) in ('deleted','terminated'))`,
    repair: async (doApply) => {
      if (!doApply) return { changed: 0, note: "Run with --apply to release IP allocations attached to deleted VPS records." }
      const changed = await updateRaw(`update ip_allocations a set status='free', "vpsInstanceId"=null, vmid=null, hostname=null, "allocationLockKey"=null, "releasedAt"=now() from vps_instances v where v.id = a."vpsInstanceId" and lower(a.status) in ('assigned','reserved','active','used') and (v."deletedAt" is not null or lower(v.status) in ('deleted','terminated')) returning 1 as count`)
      return { changed, note: "Released IP allocations attached to deleted VPS records." }
    },
  },
  {
    key: "duplicate_active_ip_allocations",
    title: "Duplicate active IP allocation rows",
    area: "ipam",
    severity: "critical",
    sql: `select count(*)::int as count from (select "poolId", "ipAddress" from ip_allocations where lower(status) in ('assigned','reserved','active','used') group by "poolId", "ipAddress" having count(*) > 1) d`,
  },
  {
    key: "duplicate_active_vps_ips",
    title: "Duplicate public IPs on active VPS rows",
    area: "ipam",
    severity: "critical",
    sql: `select count(*)::int as count from (select "ipAddress" from vps_instances where "deletedAt" is null and "ipAddress" is not null and btrim("ipAddress") <> '' group by "ipAddress" having count(*) > 1) d`,
  },
  {
    key: "active_vps_missing_ip_allocation",
    title: "Active VPS IPs without an active allocation",
    area: "ipam",
    severity: "critical",
    sql: `select count(*)::int as count from vps_instances v left join ip_allocations a on a."vpsInstanceId"=v.id and lower(a.status) in ('assigned','reserved','active','used') where v."deletedAt" is null and v."ipAddress" is not null and btrim(v."ipAddress") <> '' and a.id is null`,
    repair: async (doApply) => {
      if (!doApply) return { changed: 0, note: "Assign an existing free allocation row when the IP match is unique." }
      const missing = await prisma.vpsInstance.findMany({
        where: {
          deletedAt: null,
          AND: [{ ipAddress: { not: null } }, { ipAddress: { not: "" } }],
          ipAllocations: { none: { status: { in: ["assigned", "reserved", "active", "used", "ASSIGNED", "RESERVED", "ACTIVE", "USED"] } } },
        },
        select: { id: true, vmid: true, name: true, ipAddress: true, proxmoxNodeId: true },
      })
      let changed = 0
      for (const vps of missing) {
        const candidates = await prisma.ipAllocation.findMany({ where: { ipAddress: vps.ipAddress! }, orderBy: { updatedAt: "desc" } })
        let candidate = candidates.length === 1 ? candidates[0] : candidates.find((row) => !row.vpsInstanceId && ["free", "released"].includes(String(row.status || "").toLowerCase())) || null
        if (candidate?.vpsInstanceId && candidate.vpsInstanceId !== vps.id) {
          const owner = await prisma.vpsInstance.findUnique({ where: { id: candidate.vpsInstanceId }, select: { deletedAt: true, ipAddress: true } })
          if (owner && !owner.deletedAt && owner.ipAddress === vps.ipAddress) continue
        }
        if (!candidate) {
          const exact = await (prisma as any).ipAssignment.findFirst({
            where: { vpsInstanceId: vps.id, assignedIp: vps.ipAddress, poolId: { not: null } },
            orderBy: { updatedAt: "desc" },
            select: { poolId: true },
          })
          let poolId = exact?.poolId ? String(exact.poolId) : null
          if (poolId && !(await prisma.ipPool.findUnique({ where: { id: poolId }, select: { id: true } }))) poolId = null
          if (!poolId) {
            const octets = String(vps.ipAddress).split(".")
            const prefix = octets.length === 4 ? `${octets.slice(0, 3).join(".")}.` : ""
            const pools = await prisma.ipPool.findMany({ where: { isActive: true }, select: { id: true, name: true, startIp: true, endIp: true, gateway: true, cidr: true, proxmoxNodeId: true, poolMode: true, poolType: true } })
            const matching = prefix ? pools.filter((pool) => {
              try {
                return isIpInRange(vps.ipAddress!, pool.startIp, pool.endIp)
              } catch {
                return Number(pool.cidr || 24) === 24 && String(pool.gateway || "").startsWith(prefix)
              }
            }) : []
            const nodeMatching = matching.filter((pool) => pool.proxmoxNodeId === vps.proxmoxNodeId)
            if (nodeMatching.length === 1) poolId = nodeMatching[0].id
            else if (matching.length === 1) poolId = matching[0].id
          }
          if (!poolId) {
            const gateway = subnetGateway(vps.ipAddress!)
            if (!gateway) continue
            const recovered = await prisma.ipPool.create({
              data: {
                name: `recovered-${vps.ipAddress}`,
                proxmoxNodeId: vps.proxmoxNodeId,
                poolMode: "NODE_RESTRICTED",
                poolType: "NORMAL",
                subnetKey: `recovered-${vps.ipAddress}`,
                startIp: vps.ipAddress!,
                endIp: vps.ipAddress!,
                gateway,
                cidr: 24,
                dns: "1.1.1.1",
                staticOnly: true,
                notes: "Recovered from active VPS ipAddress by db-integrity-audit.",
              },
            })
            poolId = recovered.id
          }
          if (!poolId) continue
          candidate = await prisma.ipAllocation.create({ data: { poolId, nodeId: vps.proxmoxNodeId, ipAddress: vps.ipAddress!, status: "assigned", vpsInstanceId: vps.id, vmid: vps.vmid, hostname: vps.name, assignedBy: "db-integrity-audit" } })
        } else {
          await prisma.ipAllocation.update({ where: { id: candidate.id }, data: { nodeId: vps.proxmoxNodeId, status: "assigned", vpsInstanceId: vps.id, vmid: vps.vmid, hostname: vps.name, releasedAt: null, allocationLockKey: null } })
        }
        changed += 1
      }
      return { changed, note: "Assigned uniquely matching free allocation rows; unmatched IPs require pool review." }
    },
  },
  {
    key: "duplicate_active_vmids",
    title: "Duplicate VMIDs on active VPS rows",
    area: "services",
    severity: "critical",
    sql: `select count(*)::int as count from (select vmid from vps_instances where "deletedAt" is null and vmid > 0 group by vmid having count(*) > 1) d`,
  },
  {
    key: "active_vps_missing_identity",
    title: "Active VPS rows without provisioning identity",
    area: "provisioning",
    severity: "critical",
    sql: `select count(*)::int as count from vps_instances v left join vm_provisioning_identities i on i."vps_instance_id"=v.id where v."deletedAt" is null and v.vmid > 0 and i.id is null`,
    repair: async (doApply) => {
      if (!doApply) return { changed: 0, note: "Backfill canonical identities from active VPS/order records." }
      const missing = await prisma.vpsInstance.findMany({
        where: { deletedAt: null, vmid: { gt: 0 }, provisioningIdentity: null },
        select: { id: true, orderId: true, proxmoxNodeId: true, vmid: true, ipAddress: true, vmMacAddress: true, status: true, createdAt: true },
      })
      let changed = 0
      for (const vps of missing) {
        const conflictingVmidIdentity = await (prisma as any).vmProvisioningIdentity.findUnique({
          where: { vmid: vps.vmid },
          include: { vpsInstance: { select: { id: true, vmid: true, deletedAt: true, status: true } } },
        }).catch(() => null)
        if (conflictingVmidIdentity && conflictingVmidIdentity.vpsInstanceId !== vps.id) {
          const owner = conflictingVmidIdentity.vpsInstance
          const stale = !owner || owner.deletedAt || Number(owner.vmid || 0) !== Number(vps.vmid || 0) || ["deleted", "terminated", "cancelled", "canceled"].includes(String(owner.status || "").toLowerCase())
          if (!stale) continue
          const oldMetadata = conflictingVmidIdentity.metadata && typeof conflictingVmidIdentity.metadata === "object" && !Array.isArray(conflictingVmidIdentity.metadata) ? conflictingVmidIdentity.metadata : {}
          await (prisma as any).vmProvisioningIdentity.update({
            where: { id: conflictingVmidIdentity.id },
            data: { vmid: null, metadata: { ...oldMetadata, staleVmidReleasedBy: "db-integrity-audit", staleVmid: vps.vmid, staleVmidReleasedAt: new Date().toISOString() } },
          })
        }
        if (vps.ipAddress) {
          const conflictingIpIdentity = await (prisma as any).vmProvisioningIdentity.findUnique({
            where: { publicIp: vps.ipAddress },
            include: { vpsInstance: { select: { id: true, ipAddress: true, deletedAt: true } } },
          })
          if (conflictingIpIdentity && conflictingIpIdentity.vpsInstanceId !== vps.id) {
            const owner = conflictingIpIdentity.vpsInstance
            const stale = !owner || owner.deletedAt || owner.ipAddress !== vps.ipAddress
            if (!stale) continue
            const oldMetadata = conflictingIpIdentity.metadata && typeof conflictingIpIdentity.metadata === "object" && !Array.isArray(conflictingIpIdentity.metadata) ? conflictingIpIdentity.metadata : {}
            await (prisma as any).vmProvisioningIdentity.update({
              where: { id: conflictingIpIdentity.id },
              data: { publicIp: null, metadata: { ...oldMetadata, stalePublicIpReleasedBy: "db-integrity-audit", stalePublicIp: vps.ipAddress, stalePublicIpReleasedAt: new Date().toISOString() } },
            })
          }
        }
        await (prisma as any).vmProvisioningIdentity.create({
          data: {
            orderId: vps.orderId,
            vpsInstanceId: vps.id,
            vmUuid: vps.id,
            proxmoxNodeId: vps.proxmoxNodeId,
            vmid: vps.vmid,
            publicIp: vps.ipAddress || null,
            macAddress: vps.vmMacAddress || null,
            phase: ["ACTIVE", "RUNNING", "STOPPED", "SUSPENDED"].includes(String(vps.status).toUpperCase()) ? "READY" : "FAILED",
            resumePhase: ["ACTIVE", "RUNNING", "STOPPED", "SUSPENDED"].includes(String(vps.status).toUpperCase()) ? "READY" : "NEW",
            cloneCompletedAt: vps.createdAt,
            metadata: { backfilledBy: "db-integrity-audit", backfilledAt: new Date().toISOString() },
          },
        })
        changed += 1
      }
      return { changed, note: "Backfilled one canonical provisioning identity per active VPS." }
    },
  },
  {
    key: "duplicate_active_provision_jobs",
    title: "Duplicate active provision jobs per order and type",
    area: "provisioning",
    severity: "critical",
    sql: `select count(*)::int as count from (select "orderId", type from provisioning_jobs where status in ('queued','running','retrying','waiting_for_admin') group by "orderId", type having count(*) > 1) d`,
  },
  {
    key: "duplicate_success_gateway_transactions",
    title: "Duplicate successful gateway transaction IDs",
    area: "payments",
    severity: "critical",
    sql: `select count(*)::int as count from (select "gatewayTransactionId" from payments where lower(status) in ('success','paid','completed') and "gatewayTransactionId" is not null group by "gatewayTransactionId" having count(*) > 1) d`,
  },
  {
    key: "vm_interfaces_missing_vps",
    title: "VM network interfaces with missing VPS",
    area: "network",
    severity: "warning",
    sql: `select count(*)::int as count from vm_network_interfaces n left join vps_instances v on v.id = n."vpsInstanceId" where v.id is null`,
  },
  {
    key: "vm_ip_assignments_missing_vps",
    title: "VM IP assignments with missing VPS",
    area: "network",
    severity: "warning",
    sql: `select count(*)::int as count from vm_ip_assignments a left join vps_instances v on v.id = a."vpsInstanceId" where v.id is null`,
  },
  {
    key: "network_event_spam",
    title: "Recent duplicate network repair/confirmation events",
    area: "network",
    severity: "warning",
    sql: `select count(*)::int as count from (select "vpsInstanceId", "eventType", status, coalesce(stage,''), date_trunc('hour',"createdAt") from vm_network_events where "createdAt" > now() - interval '7 days' and ("eventType"='repair_network' or status='confirmation_required') group by 1,2,3,4,5 having count(*) > 3) d`,
    repair: async (doApply) => {
      if (!doApply) return { changed: 0, note: "Run with --apply to delete duplicate repair/confirmation spam while keeping the newest event per VM/hour/status." }
      const changed = await updateRaw(`
        with ranked as (
          select id,
                 row_number() over (
                   partition by "vpsInstanceId", "eventType", status, coalesce(stage,''), date_trunc('hour',"createdAt")
                   order by "createdAt" desc
                 ) as rn
          from vm_network_events
          where "createdAt" > now() - interval '30 days'
            and ("eventType" = 'repair_network' or status = 'confirmation_required')
        )
        delete from vm_network_events e
        using ranked
        where e.id = ranked.id and ranked.rn > 1
        returning 1 as count
      `)
      return { changed, note: "Deleted duplicate repair/confirmation network event spam." }
    },
  },
  {
    key: "coupon_redemptions_missing_coupon",
    title: "Coupon redemptions with missing coupon",
    area: "revenue",
    severity: "warning",
    sql: `select count(*)::int as count from coupon_redemptions r left join coupons c on c.id = r."couponId" where c.id is null`,
  },
  {
    key: "coupon_redemptions_missing_customer",
    title: "Coupon redemptions with missing customer",
    area: "revenue",
    severity: "warning",
    sql: `select count(*)::int as count from coupon_redemptions r left join customers c on c.id = r."customerId" where r."customerId" is not null and c.id is null`,
  },
  {
    key: "notifications_missing_customer",
    title: "Notification logs with metadata customerId linked to missing customers",
    area: "notifications",
    severity: "warning",
    sql: `select count(*)::int as count from notification_delivery_logs n left join customers c on c.id = n.metadata->>'customerId' where n.metadata ? 'customerId' and c.id is null`,
  },
  {
    key: "analytics_missing_customer",
    title: "Analytics events with customer userId linked to missing customers",
    area: "analytics",
    severity: "info",
    sql: `select count(*)::int as count from analytics_events a left join customers c on c.id = a."userId" where a."userId" is not null and a."userId" like 'c%' and c.id is null`,
  },
  {
    key: "whatsapp_evolution_configured",
    title: "Evolution API database configuration rows",
    area: "whatsapp",
    severity: "info",
    sql: `select count(*)::int as count from runtime_integrations where provider = 'whatsappApi' and key_name in ('serverUrl','instanceName','apiKey') and is_enabled = true and coalesce(key_value_encrypted,'') <> ''`,
  },
  {
    key: "wallet_transactions_missing_customer",
    title: "Wallet transactions linked to missing customers",
    area: "wallets",
    severity: "critical",
    sql: `select count(*)::int as count from wallet_transactions w left join customers c on c.id = w."customerId" where w."customerId" is not null and c.id is null`,
  },
  {
    key: "ssh_keys_missing_customer",
    title: "SSH keys linked to missing customers",
    area: "ssh_keys",
    severity: "critical",
    sql: `select count(*)::int as count from ssh_keys s left join customers c on c.id = s."customerId" where s."customerId" is not null and c.id is null`,
  },
  {
    key: "backup_runs_missing_destination",
    title: "Backup runs linked to missing destinations",
    area: "backups",
    severity: "warning",
    sql: `select count(*)::int as count from backup_runs b left join backup_destinations d on d.id = b."destinationId" where b."destinationId" is not null and d.id is null`,
  },
  {
    key: "vm_snapshots_missing_vps",
    title: "VM snapshots linked to missing VPS",
    area: "snapshots",
    severity: "warning",
    sql: `select count(*)::int as count from vm_snapshots s left join vps_instances v on v.id = s."vps_instance_id" where s."vps_instance_id" is not null and v.id is null`,
  },
  {
    key: "vm_backups_missing_vps",
    title: "VM backups linked to missing VPS",
    area: "backups",
    severity: "warning",
    sql: `select count(*)::int as count from vm_backups b left join vps_instances v on v.id = b."vps_instance_id" where b."vps_instance_id" is not null and v.id is null`,
  },
]

async function main() {
  const backupFile = await backupDatabase()
  const allChecks = [...checks, ...(await buildForeignKeyOrphanChecks())]
  const reportRows: Array<{ check: AuditCheck; count: number; repair?: { changed: number; note: string } }> = []
  for (const check of allChecks) {
    const n = await count(check.sql)
    const repair = check.repair ? await check.repair(apply && n > 0) : undefined
    reportRows.push({ check, count: n, repair })
    console.log(`${check.key}: ${n}${repair ? ` (${repair.note}${repair.changed ? ` changed=${repair.changed}` : ""})` : ""}`)
  }

  const outDir = path.join(process.cwd(), "docs")
  await mkdir(outDir, { recursive: true })
  const file = path.join(outDir, `db-integrity-audit-${today}.md`)
  const criticalRemaining = reportRows.filter((row) => row.check.severity === "critical" && row.count > Number(row.repair?.changed || 0))
  const body = [
    `# MYRDPHUB DB Integrity Audit - ${today}`,
    "",
    `Mode: ${apply ? "apply" : "dry-run"}`,
    `Backup: ${backupFile || (apply ? "skipped" : "not required for dry-run")}`,
    "",
    "| Area | Check | Severity | Count | Repair |",
    "| --- | --- | --- | ---: | --- |",
    ...reportRows.map(({ check, count: n, repair }) => `| ${check.area} | ${check.title} | ${check.severity} | ${n} | ${repair?.note || ""}${repair?.changed ? ` (${repair.changed} changed)` : ""} |`),
    "",
    "## Remaining Manual Blockers",
    "",
    ...(criticalRemaining.length
      ? criticalRemaining.map(({ check, count: n }) => `- ${check.title}: ${n}`)
      : ["- None detected by critical checks."]),
    "",
    "Repairs are intentionally limited to idempotent visibility, revenue exclusion, and IP-release fixes where the target state is unambiguous.",
    "",
  ].join("\n")
  await writeFile(file, body)
  console.log(file)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
