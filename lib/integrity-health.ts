import { prisma } from "@/lib/db"

export type IntegrityHealth = {
  healthy: boolean
  duplicateIps: number
  duplicateVmids: number
  duplicateOrders: number
  duplicatePayments: number
  orderlessInvoices: number
  missingIpAllocations: number
  missingProvisioningIdentities: number
  failedPayments: number
  failedProvisionJobs: number
  pendingProvisionJobs: number
  unvalidatedForeignKeys: number
}

export async function getIntegrityHealth(): Promise<IntegrityHealth> {
  const rows = await prisma.$queryRaw<Array<Record<string, bigint | number>>>`
    SELECT
      (SELECT count(*) FROM (SELECT "ipAddress" FROM vps_instances WHERE "deletedAt" IS NULL AND "ipAddress" IS NOT NULL GROUP BY "ipAddress" HAVING count(*) > 1) d) AS "duplicateIps",
      (SELECT count(*) FROM (SELECT vmid FROM vps_instances WHERE "deletedAt" IS NULL AND vmid > 0 GROUP BY vmid HAVING count(*) > 1) d) AS "duplicateVmids",
      (SELECT count(*) FROM (SELECT "orderNumber" FROM orders GROUP BY "orderNumber" HAVING count(*) > 1) d) AS "duplicateOrders",
      (SELECT count(*) FROM (SELECT "gatewayTransactionId" FROM payments WHERE lower(status) IN ('completed','paid','success') AND "gatewayTransactionId" IS NOT NULL GROUP BY "gatewayTransactionId" HAVING count(*) > 1) d) AS "duplicatePayments",
      (SELECT count(*) FROM invoices WHERE "deletedAt" IS NULL AND lower(coalesce(type,'service'))='service' AND "orderId" IS NULL) AS "orderlessInvoices",
      (SELECT count(*) FROM vps_instances v LEFT JOIN ip_allocations a ON a."vpsInstanceId"=v.id AND lower(a.status) IN ('assigned','reserved','active','used') WHERE v."deletedAt" IS NULL AND v."ipAddress" IS NOT NULL AND a.id IS NULL) AS "missingIpAllocations",
      (SELECT count(*) FROM vps_instances v LEFT JOIN vm_provisioning_identities i ON i."vps_instance_id"=v.id WHERE v."deletedAt" IS NULL AND v.vmid > 0 AND i.id IS NULL) AS "missingProvisioningIdentities",
      (SELECT count(*) FROM payments WHERE lower(status) IN ('failed','error','declined')) AS "failedPayments",
      (SELECT count(*) FROM provisioning_jobs WHERE status='failed') AS "failedProvisionJobs",
      (SELECT count(*) FROM provisioning_jobs WHERE status IN ('queued','running','retrying','waiting_for_admin')) AS "pendingProvisionJobs",
      (SELECT count(*) FROM pg_constraint WHERE contype='f' AND NOT convalidated) AS "unvalidatedForeignKeys"
  `
  const row = rows[0] || {}
  const number = (key: string) => Number(row[key] || 0)
  const health = {
    duplicateIps: number("duplicateIps"),
    duplicateVmids: number("duplicateVmids"),
    duplicateOrders: number("duplicateOrders"),
    duplicatePayments: number("duplicatePayments"),
    orderlessInvoices: number("orderlessInvoices"),
    missingIpAllocations: number("missingIpAllocations"),
    missingProvisioningIdentities: number("missingProvisioningIdentities"),
    failedPayments: number("failedPayments"),
    failedProvisionJobs: number("failedProvisionJobs"),
    pendingProvisionJobs: number("pendingProvisionJobs"),
    unvalidatedForeignKeys: number("unvalidatedForeignKeys"),
  }
  return {
    healthy: health.duplicateIps === 0 && health.duplicateVmids === 0 && health.duplicateOrders === 0 && health.duplicatePayments === 0 && health.orderlessInvoices === 0 && health.missingIpAllocations === 0 && health.missingProvisioningIdentities === 0 && health.unvalidatedForeignKeys === 0,
    ...health,
  }
}
