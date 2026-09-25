import { getAggregatedAdminData, type AdminAggregateFilters, type AdminOrderHealthRow } from "@/lib/admin-data-aggregator"
import { resolveCanonicalVmDataForVpsIds } from "@/lib/vm-db-truth"
import { instanceDisplayName } from "@/lib/vm-hostname"

export type AdminOrdersWithVmStatusResponse = {
  rows: AdminOrderHealthRow[]
  pagination: {
    page: number
    pageSize: number
    total: number
    pages: number
  }
  diagnosticsSummary: {
    rowsWithIssues: number
    staleVmStates: number
    networkMismatch: number
    provisioningFailed: number
    paymentFailed: number
  }
  consistency: {
    checkedAt: string
    totals: {
      ordersScanned: number
      vmRows: number
    }
    issues: {
      paidWithoutService: number
      vmWithoutProvisioningLink: number
      ipOwnershipMismatch: number
      activeInvoiceMismatch: number
      orphanProvisioningJobs: number
      orphanVms: number
    }
    samples: {
      paidWithoutServiceOrderIds: string[]
      vmWithoutProvisioningOrderIds: string[]
      ipMismatchOrderIds: string[]
    }
  }
  degraded?: {
    degradedMode: boolean
    degradedReasons: string[]
  }
  vmStatusPartial?: boolean
  partialWarnings?: string[]
  startupSchema?: {
    ok: boolean
    checkedAt: string
    missingTables: string[]
    missingColumns: Array<{ table: string; column: string }>
    pendingMigrations: string[]
    failedMigrations: string[]
    pendingDeploy: boolean
    degradedFeatures: string[]
    failedStartupChecks: string[]
  }
}

export type AdminVmOverviewRow = {
  id: string
  name: string
  vmid: number
  status: string
  ipAddress: string | null
  macAddress?: string | null
  os?: string | null
  cpuCores?: number | null
  ramGb?: number | null
  diskGb?: number | null
  bandwidthTb?: number | null
  customer: { id: string; email: string; name: string | null } | null
  order: { id: string; orderNumber: string; status: string }
  nodeName: string | null
  nextRenewalAt: string | null
  renewalDueAt: string | null
  suspendAt: string | null
  penaltyAt: string | null
  terminationAt: string | null
  deletionAt: string | null
  penaltyAppliedAt: string | null
  lastReminderLevel: string | null
  lastReminderSentAt: string | null
  autoSuspendEnabled: boolean | null
  autoDeleteEnabled: boolean | null
  automationPausedAt: string | null
  remindersPausedAt: string | null
  renewalAmount: number | null
  health: AdminOrderHealthRow["health"]
  provisioning: AdminOrderHealthRow["provisioning"]
  network: AdminOrderHealthRow["network"]
  diagnostics: AdminOrderHealthRow["diagnostics"]
}

export type AdminVmOverviewResponse = {
  rows: AdminVmOverviewRow[]
  pagination: {
    page: number
    pageSize: number
    total: number
    pages: number
  }
  diagnosticsSummary: AdminOrdersWithVmStatusResponse["diagnosticsSummary"]
  vmStatusPartial?: boolean
  partialWarnings?: string[]
}

export async function getAdminOrdersWithVmStatus(filters: AdminAggregateFilters = {}): Promise<AdminOrdersWithVmStatusResponse> {
  const aggregated = await getAggregatedAdminData(filters)
  return {
    rows: aggregated.rows,
    pagination: aggregated.pagination,
    diagnosticsSummary: aggregated.diagnosticsSummary,
    consistency: aggregated.consistency,
    degraded: aggregated.degraded,
    vmStatusPartial: aggregated.vmStatusPartial,
    partialWarnings: aggregated.partialWarnings,
    startupSchema: aggregated.startupSchema,
  }
}

export async function getAdminVmOverview(filters: AdminAggregateFilters = {}): Promise<AdminVmOverviewResponse> {
  const aggregated = await getAggregatedAdminData(filters)
  const canonicalById = await resolveCanonicalVmDataForVpsIds(aggregated.rows.filter((row) => Boolean(row.vm)).map((row) => String(row.vm!.id)))
  const vmRows = aggregated.rows
    .filter((row) => Boolean(row.vm))
    .map((row) => {
      const canonical = canonicalById.get(String(row.vm!.id))
      return ({
      id: String(row.vm!.id),
      name: instanceDisplayName(row.vm),
      vmid: Number(row.vm!.vmid),
      status: String(canonical?.state?.status || canonical?.runtime?.status || row.vm!.status),
      ipAddress: canonical?.primaryIp || (row.vm as any).ipAddress || row.network?.primaryAssignedIp || null,
      macAddress: (row.vm as any).vmMacAddress || canonical?.macAddress || null,
      os: (row.vm as any).os || null,
      cpuCores: (row.vm as any).cpuCores || canonical?.runtime?.cpuCores || null,
      ramGb: (row.vm as any).ramGb || canonical?.runtime?.ramGb || null,
      diskGb: (row.vm as any).diskGb || canonical?.runtime?.diskGb || null,
      bandwidthTb: (row.vm as any).bandwidthTb || canonical?.runtime?.bandwidthTb || null,
      customer: row.customer,
      order: {
        id: row.order.id,
        orderNumber: row.order.orderNumber,
        status: row.order.status,
      },
      nodeName: row.vm!.nodeName,
      nextRenewalAt: row.vm!.nextRenewalAt,
      renewalDueAt: (row.vm as any).renewalDueAt || row.vm!.nextRenewalAt,
      suspendAt: (row.vm as any).suspendAt || null,
      penaltyAt: (row.vm as any).penaltyAt || null,
      terminationAt: (row.vm as any).terminationAt || null,
      deletionAt: (row.vm as any).deletionAt || null,
      penaltyAppliedAt: (row.vm as any).penaltyAppliedAt || null,
      lastReminderLevel: (row.vm as any).lastReminderLevel || null,
      lastReminderSentAt: (row.vm as any).lastReminderSentAt || null,
      autoSuspendEnabled: (row.vm as any).autoSuspendEnabled ?? null,
      autoDeleteEnabled: (row.vm as any).autoDeleteEnabled ?? null,
      automationPausedAt: (row.vm as any).automationPausedAt || null,
      remindersPausedAt: (row.vm as any).remindersPausedAt || null,
      renewalAmount: row.vm!.renewalAmount,
      health: row.health,
      provisioning: row.provisioning,
      network: {
        ...row.network,
        primaryAssignedIp: canonical?.primaryIp || row.network?.primaryAssignedIp || (row.vm as any).ipAddress || null,
      },
      diagnostics: row.diagnostics,
    })})

  return {
    rows: vmRows,
    pagination: aggregated.pagination,
    diagnosticsSummary: aggregated.diagnosticsSummary,
    ...(aggregated.vmStatusPartial ? { vmStatusPartial: aggregated.vmStatusPartial, partialWarnings: aggregated.partialWarnings } : {}),
  }
}
